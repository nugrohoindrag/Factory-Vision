package security

import (
	"crypto/rand"
	"crypto/subtle"
	"encoding/hex"
	"fmt"
	"regexp"
	"strings"

	"golang.org/x/crypto/scrypt"

	"github.com/nugrohoindrag/factory-vision/apps/api/internal/platform/httpx"
)

// Password and PIN hashing (US-001, US-002), byte-compatible with the Node
// API so every stored credential keeps working after the cutover.
//
// The stored form is `scrypt$<salt hex>$<hash hex>`. Node's scryptSync used
// N=16384, r=8, p=1 and a 64-byte key, and — the detail that matters — took
// the 32-character hex *string* as the salt bytes, not the 16 bytes it
// encodes. Reproduced exactly, because a verifier that derived a different
// key would lock every existing account out.
const (
	scryptN      = 16384
	scryptR      = 8
	scryptP      = 1
	scryptKeyLen = 64
)

// HashSecret hashes a password or PIN with a fresh salt.
func HashSecret(secret string) string {
	var salt [16]byte
	if _, err := rand.Read(salt[:]); err != nil {
		panic(err)
	}
	saltHex := hex.EncodeToString(salt[:])
	derived, err := scrypt.Key([]byte(secret), []byte(saltHex), scryptN, scryptR, scryptP, scryptKeyLen)
	if err != nil {
		panic(err)
	}
	return "scrypt$" + saltHex + "$" + hex.EncodeToString(derived)
}

// VerifySecret compares in constant time so a wrong password and a wrong
// user cost the same.
func VerifySecret(secret string, stored *string) bool {
	if stored == nil || *stored == "" {
		return false
	}
	parts := strings.Split(*stored, "$")
	if len(parts) != 3 || parts[0] != "scrypt" || parts[1] == "" || parts[2] == "" {
		return false
	}
	expected, err := hex.DecodeString(parts[2])
	if err != nil {
		return false
	}
	derived, err := scrypt.Key([]byte(secret), []byte(parts[1]), scryptN, scryptR, scryptP, scryptKeyLen)
	if err != nil || len(derived) != len(expected) {
		return false
	}
	return subtle.ConstantTimeCompare(derived, expected) == 1
}

// Policy is the one password and PIN policy, applied on every path that
// sets a credential (§4.1, §8, §20). A credential is only as strong as the
// weakest door that can set it, so there is exactly one door.
type Policy struct {
	PasswordMin int
	PINMin      int
}

// NewPolicy clamps the configured minimums to the defaults, as the Node API
// did: a configuration cannot weaken the baseline, only raise it.
func NewPolicy(passwordMin, pinMin int) Policy {
	if passwordMin < 12 {
		passwordMin = 12
	}
	if pinMin < 6 {
		pinMin = 6
	}
	return Policy{PasswordMin: passwordMin, PINMin: pinMin}
}

var onlySpaces = regexp.MustCompile(`^\s+$`)

// AssertPassword rejects a password below policy.
func (p Policy) AssertPassword(password, field string) error {
	if field == "" {
		field = "password"
	}
	if len([]rune(password)) < p.PasswordMin {
		msg := fmt.Sprintf("Kata sandi minimal %d karakter.", p.PasswordMin)
		return httpx.Validation(msg, httpx.FieldError{Field: field, Code: "TOO_SHORT", Message: msg})
	}
	if onlySpaces.MatchString(password) {
		msg := "Kata sandi tidak boleh hanya berisi spasi."
		return httpx.Validation(msg, httpx.FieldError{Field: field, Code: "INVALID_FORMAT", Message: msg})
	}
	return nil
}

// AssertPIN rejects a PIN below policy. A keypad has ten keys, so the
// obvious sequences are named.
func (p Policy) AssertPIN(pin, field string) error {
	if field == "" {
		field = "pin"
	}
	pattern := regexp.MustCompile(fmt.Sprintf(`^\d{%d,12}$`, p.PINMin))
	if !pattern.MatchString(pin) {
		msg := fmt.Sprintf("PIN harus %d-12 digit angka.", p.PINMin)
		return httpx.Validation(msg, httpx.FieldError{Field: field, Code: "INVALID_FORMAT", Message: msg})
	}
	if isTrivialPIN(pin) {
		msg := "PIN tidak boleh berupa angka berurutan atau berulang."
		return httpx.Validation(msg, httpx.FieldError{Field: field, Code: "TOO_WEAK", Message: msg})
	}
	return nil
}

func isTrivialPIN(pin string) bool {
	// 000000, 111111: every digit the same.
	if len(pin) > 0 && strings.Count(pin, string(pin[0])) == len(pin) {
		return true
	}
	return strings.Contains("0123456789012345", pin) || strings.Contains("9876543210987654", pin)
}

// Describe is the policy check without the error type, for configuration
// read at boot: a bad BOOTSTRAP_ADMIN_PASSWORD should be reported and
// ignored, not crash the process into a restart loop.
func (p Policy) Describe(secret, kind string) string {
	var err error
	if kind == "password" {
		err = p.AssertPassword(secret, "")
	} else {
		err = p.AssertPIN(secret, "")
	}
	if err == nil {
		return ""
	}
	if e, ok := err.(*httpx.Error); ok {
		return e.Message
	}
	return "Kredensial tidak memenuhi kebijakan."
}
