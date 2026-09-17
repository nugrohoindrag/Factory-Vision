package security

import (
	"strings"
	"testing"
	"time"
)

// The values below were produced by the Node API (credentials.ts,
// secret-box.ts, totp.ts) so the Go implementations are checked against
// what is actually stored in a database today, not against themselves.

const nodeScryptHash = "scrypt$2ec21ff999eb4829b77a300162178141$a7cbfe51310becef29550f060a0935557b527055d958129ae3df010b356fb1b2d4c2730ce1eacead5a5fefd38ec78fe9b06a1bc4c5e486328aa7c445905c20b3"

func TestVerifySecretAcceptsNodeHash(t *testing.T) {
	hash := nodeScryptHash
	if !VerifySecret("Password-123456", &hash) {
		t.Fatal("a hash written by the Node API must verify")
	}
	if VerifySecret("Password-1234567", &hash) {
		t.Fatal("a wrong password must not verify")
	}
	if VerifySecret("Password-123456", nil) {
		t.Fatal("no stored hash must not verify")
	}
}

func TestHashSecretRoundTripsAndKeepsTheStoredForm(t *testing.T) {
	h := HashSecret("shift-pin-9182")
	parts := strings.Split(h, "$")
	if len(parts) != 3 || parts[0] != "scrypt" || len(parts[1]) != 32 || len(parts[2]) != 128 {
		t.Fatalf("unexpected form %q", h)
	}
	if !VerifySecret("shift-pin-9182", &h) {
		t.Fatal("fresh hash must verify")
	}
}

func TestSecretBoxOpensNodeSealedValue(t *testing.T) {
	box := NewSecretBox("unit-test-passphrase")
	got, err := box.Open("v1:wvdZbnrJ7nMKccWo:Xc8Z4Be+V4L9y1+lrnjxyA==:rTMBvsRl272gBBz/r1CZWQ==")
	if err != nil {
		t.Fatal(err)
	}
	if got != "JBSWY3DPEHPK3PXP" {
		t.Fatalf("got %q", got)
	}
	sealed, err := box.Seal("JBSWY3DPEHPK3PXP")
	if err != nil {
		t.Fatal(err)
	}
	back, err := box.Open(sealed)
	if err != nil || back != "JBSWY3DPEHPK3PXP" {
		t.Fatalf("round trip failed: %v %q", err, back)
	}
	// A modified ciphertext is refused rather than silently decrypted.
	tampered := sealed[:len(sealed)-2] + "AA"
	if _, err := box.Open(tampered); err == nil {
		t.Fatal("tampered value must not open")
	}
	if NewSecretBox("").Available() {
		t.Fatal("no key must mean unavailable")
	}
}

func TestTOTPMatchesRFC6238AndNode(t *testing.T) {
	// The RFC 6238 seed, base32-encoded here rather than pasted: the encoded
	// form reads as a credential to a secret scanner, and it is a published
	// test vector, not a secret.
	secret := base32NoPad.EncodeToString([]byte("12345678901234567890"))
	cases := map[int64]string{59: "287082", 1111111109: "081804"}
	for at, want := range cases {
		got, err := TOTPCode(secret, time.Unix(at, 0))
		if err != nil {
			t.Fatal(err)
		}
		if got != want {
			t.Fatalf("at %d: got %s want %s", at, got, want)
		}
	}
	if !VerifyTOTP(secret, "287 082", time.Unix(59, 0)) {
		t.Fatal("whitespace inside a code must be ignored")
	}
	if !VerifyTOTP(secret, "287082", time.Unix(59+30, 0)) {
		t.Fatal("one step of skew must be tolerated")
	}
	if VerifyTOTP(secret, "287082", time.Unix(59+90, 0)) {
		t.Fatal("three steps of skew must be refused")
	}
	if VerifyTOTP(secret, "28708", time.Unix(59, 0)) {
		t.Fatal("five digits must be refused")
	}
}

func TestCredentialGuardLocksAfterLimit(t *testing.T) {
	g := NewCredentialGuard(3, time.Minute, time.Minute)
	now := time.Date(2026, 9, 17, 8, 0, 0, 0, time.UTC)
	g.now = func() time.Time { return now }
	if g.RecordFailure("a") || g.RecordFailure("a") {
		t.Fatal("first failures must not lock")
	}
	if !g.RecordFailure("a") {
		t.Fatal("third failure must lock")
	}
	if s := g.SecondsLocked("a"); s != 60 {
		t.Fatalf("expected 60s lock, got %d", s)
	}
	if err := g.AssertAvailable("a", "locked"); err == nil {
		t.Fatal("locked identity must be refused")
	}
	now = now.Add(61 * time.Second)
	if s := g.SecondsLocked("a"); s != 0 {
		t.Fatalf("lock must expire, got %d", s)
	}
	g.RecordSuccess("a")
}

func TestRequestLimiterSlidingWindow(t *testing.T) {
	l := NewRequestLimiter(2, time.Minute)
	now := time.Date(2026, 9, 17, 8, 0, 0, 0, time.UTC)
	l.now = func() time.Time { return now }
	if l.Consume("k") != 0 || l.Consume("k") != 0 {
		t.Fatal("first two calls allowed")
	}
	if wait := l.Consume("k"); wait != 60 {
		t.Fatalf("third call refused for 60s, got %d", wait)
	}
	now = now.Add(61 * time.Second)
	if l.Consume("k") != 0 {
		t.Fatal("window must slide")
	}
}

func TestPolicyMessages(t *testing.T) {
	p := NewPolicy(8, 4) // clamped to 12 / 6
	if p.PasswordMin != 12 || p.PINMin != 6 {
		t.Fatalf("policy must not weaken below the baseline: %+v", p)
	}
	if got := p.Describe("short", "password"); got != "Kata sandi minimal 12 karakter." {
		t.Fatalf("got %q", got)
	}
	if got := p.Describe("123456", "pin"); got != "PIN tidak boleh berupa angka berurutan atau berulang." {
		t.Fatalf("got %q", got)
	}
	if got := p.Describe("284617", "pin"); got != "" {
		t.Fatalf("valid pin rejected: %q", got)
	}
	if got := p.Describe("12", "pin"); got != "PIN harus 6-12 digit angka." {
		t.Fatalf("got %q", got)
	}
}
