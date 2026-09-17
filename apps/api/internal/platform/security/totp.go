package security

import (
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha1"
	"crypto/subtle"
	"encoding/base32"
	"encoding/binary"
	"encoding/hex"
	"fmt"
	"net/url"
	"regexp"
	"strings"
	"time"
)

// TOTP, RFC 6238 (§5): HMAC-SHA1, six digits, thirty-second step — not a
// security choice so much as an interoperability one, since Google
// Authenticator, Aegis, 1Password and the rest will not read anything else
// without manual configuration.

const (
	totpDigits = 6
	totpStep   = 30 * time.Second
	// totpWindow is the skew tolerated on either side, in steps.
	totpWindow = 1
)

var base32NoPad = base32.StdEncoding.WithPadding(base32.NoPadding)

// GenerateTOTPSecret is 160 bits, what the RFC recommends for HMAC-SHA1.
func GenerateTOTPSecret() string {
	var b [20]byte
	if _, err := rand.Read(b[:]); err != nil {
		panic(err)
	}
	return base32NoPad.EncodeToString(b[:])
}

func decodeBase32(secret string) ([]byte, error) {
	cleaned := strings.ToUpper(strings.TrimRight(strings.Join(strings.Fields(secret), ""), "="))
	return base32NoPad.DecodeString(cleaned)
}

// TOTPCode is the code for an instant.
func TOTPCode(secret string, at time.Time) (string, error) {
	key, err := decodeBase32(secret)
	if err != nil {
		return "", err
	}
	counter := uint64(at.Unix() / int64(totpStep.Seconds()))
	var msg [8]byte
	binary.BigEndian.PutUint64(msg[:], counter)
	mac := hmac.New(sha1.New, key)
	mac.Write(msg[:])
	digest := mac.Sum(nil)
	offset := digest[len(digest)-1] & 0x0f
	bin := (uint32(digest[offset])&0x7f)<<24 |
		uint32(digest[offset+1])<<16 |
		uint32(digest[offset+2])<<8 |
		uint32(digest[offset+3])
	return fmt.Sprintf("%06d", bin%1_000_000), nil
}

var sixDigits = regexp.MustCompile(`^\d{6}$`)

// VerifyTOTP checks a code with clock skew, in constant time per candidate.
func VerifyTOTP(secret, code string, at time.Time) bool {
	candidate := strings.Join(strings.Fields(code), "")
	if !sixDigits.MatchString(candidate) {
		return false
	}
	ok := false
	for drift := -totpWindow; drift <= totpWindow; drift++ {
		generated, err := TOTPCode(secret, at.Add(time.Duration(drift)*totpStep))
		if err != nil {
			return false
		}
		if subtle.ConstantTimeCompare([]byte(generated), []byte(candidate)) == 1 {
			ok = true
		}
	}
	return ok
}

// OTPAuthURI is what an authenticator app reads, from a QR code or by hand.
func OTPAuthURI(secret, account, issuer string) string {
	label := url.PathEscape(issuer + ":" + account)
	params := url.Values{}
	params.Set("secret", secret)
	params.Set("issuer", issuer)
	params.Set("algorithm", "SHA1")
	params.Set("digits", fmt.Sprint(totpDigits))
	params.Set("period", fmt.Sprint(int(totpStep.Seconds())))
	return "otpauth://totp/" + label + "?" + params.Encode()
}

// GenerateRecoveryCodes mints the one route back in when the phone is lost.
// Treated as credentials: shown once, stored only as hashes, single use.
func GenerateRecoveryCodes(count int) []string {
	codes := make([]string, 0, count)
	for range count {
		var b [5]byte
		if _, err := rand.Read(b[:]); err != nil {
			panic(err)
		}
		raw := strings.ToUpper(hex.EncodeToString(b[:]))
		codes = append(codes, raw[:5]+"-"+raw[5:])
	}
	return codes
}
