"""Accounts, sessions and the audit trail.

Passwords are scrypt, stored as scrypt$<salt>$<hash> (base64), the shape the
MES uses. A session is a signed cookie — username and expiry, HMAC-SHA256 —
so the server keeps no session table; disabling an account takes effect on
the next request because the user row is read every time.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import logging
import os
import secrets
import time
from dataclasses import dataclass

log = logging.getLogger(__name__)

COOKIE = "fvv_session"
# Every state-changing request must carry this header. A cross-site form or
# fetch cannot set it without a CORS preflight, which this app never answers.
CSRF_HEADER = "x-fv-request"
MIN_PASSWORD = 12

_SCRYPT = {"n": 2**14, "r": 8, "p": 1, "dklen": 32}


def _b64(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode()


def _unb64(text: str) -> bytes:
    return base64.urlsafe_b64decode(text + "=" * (-len(text) % 4))


def hash_password(password: str) -> str:
    salt = os.urandom(16)
    digest = hashlib.scrypt(password.encode(), salt=salt, **_SCRYPT)
    return f"scrypt${_b64(salt)}${_b64(digest)}"


def check_password(password: str, stored: str) -> bool:
    try:
        scheme, salt, digest = stored.split("$")
        if scheme != "scrypt":
            return False
        actual = hashlib.scrypt(password.encode(), salt=_unb64(salt), **_SCRYPT)
        return hmac.compare_digest(actual, _unb64(digest))
    except (ValueError, TypeError):
        return False


@dataclass
class User:
    username: str
    display_name: str
    role: str

    @property
    def is_admin(self) -> bool:
        return self.role == "admin"


class Sessions:
    def __init__(self, secret: str | None, hours: float = 12):
        if not secret:
            # Sessions then die with the process; fine locally, wrong on a host.
            log.warning("VISION_SESSION_SECRET is not set: sessions end on every restart")
            secret = secrets.token_urlsafe(32)
        self._key = secret.encode()
        self.max_age = int(hours * 3600)

    def issue(self, username: str) -> str:
        payload = f"{username}|{int(time.time()) + self.max_age}".encode()
        sig = hmac.new(self._key, payload, hashlib.sha256).digest()
        return f"{_b64(payload)}.{_b64(sig)}"

    def read(self, token: str | None) -> str | None:
        if not token or "." not in token:
            return None
        try:
            payload_b64, sig_b64 = token.split(".", 1)
            payload = _unb64(payload_b64)
            expected = hmac.new(self._key, payload, hashlib.sha256).digest()
            if not hmac.compare_digest(expected, _unb64(sig_b64)):
                return None
            username, expires = payload.decode().rsplit("|", 1)
            return username if int(expires) > time.time() else None
        except (ValueError, UnicodeDecodeError):
            return None


class LoginThrottle:
    """Five failures for a username or address lock it for a minute."""

    def __init__(self, limit: int = 5, window: float = 60.0):
        self.limit, self.window = limit, window
        self._fails: dict[str, list[float]] = {}

    def _recent(self, key: str) -> list[float]:
        now = time.monotonic()
        fails = [t for t in self._fails.get(key, []) if now - t < self.window]
        self._fails[key] = fails
        return fails

    def blocked(self, *keys: str) -> bool:
        return any(len(self._recent(k)) >= self.limit for k in keys)

    def fail(self, *keys: str) -> None:
        for k in keys:
            self._recent(k).append(time.monotonic())

    def clear(self, *keys: str) -> None:
        for k in keys:
            self._fails.pop(k, None)
