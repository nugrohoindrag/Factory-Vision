package security

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"errors"
	"strings"
)

// Authenticated encryption for the few secrets that must be recoverable
// (§14, §34). A TOTP secret has to survive in a readable form because
// verifying a code means regenerating it; what keeps it safe is that the key
// lives outside the database, in MFA_ENCRYPTION_KEY, so a backup carries
// ciphertext and nothing else.
//
// Format: `v1:<iv base64>:<tag base64>:<ciphertext base64>`, AES-256-GCM,
// exactly what the Node API wrote, so enrolments made before the cutover
// still open.

const sealVersion = "v1"

// ErrMissingEncryptionKey is returned when MFA is used without a key.
var ErrMissingEncryptionKey = errors.New("MFA_ENCRYPTION_KEY is not set. Multi-factor enrolment stores an encrypted secret and refuses to store one it cannot protect.")

// SecretBox seals and opens with one key.
type SecretBox struct {
	key []byte // nil when unavailable
}

// NewSecretBox derives the 32-byte key from the configured value, which may
// be a base64 key or an ordinary passphrase; both end up the same length
// through SHA-256. Refusing anything that is not perfectly formatted is how
// installations end up with the feature switched off instead.
func NewSecretBox(configured string) *SecretBox {
	configured = strings.TrimSpace(configured)
	if configured == "" {
		return &SecretBox{}
	}
	sum := sha256.Sum256([]byte(configured))
	return &SecretBox{key: sum[:]}
}

// Available reports whether a key is configured.
func (b *SecretBox) Available() bool { return b.key != nil }

// Seal encrypts plaintext.
func (b *SecretBox) Seal(plaintext string) (string, error) {
	if b.key == nil {
		return "", ErrMissingEncryptionKey
	}
	block, err := aes.NewCipher(b.key)
	if err != nil {
		return "", err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return "", err
	}
	iv := make([]byte, 12)
	if _, err := rand.Read(iv); err != nil {
		return "", err
	}
	sealed := gcm.Seal(nil, iv, []byte(plaintext), nil)
	// Go appends the 16-byte tag; Node stored it as its own field.
	ciphertext, tag := sealed[:len(sealed)-gcm.Overhead()], sealed[len(sealed)-gcm.Overhead():]
	enc := base64.StdEncoding
	return strings.Join([]string{sealVersion, enc.EncodeToString(iv), enc.EncodeToString(tag), enc.EncodeToString(ciphertext)}, ":"), nil
}

// Open decrypts a sealed value; a modified ciphertext is refused.
func (b *SecretBox) Open(sealed string) (string, error) {
	if b.key == nil {
		return "", ErrMissingEncryptionKey
	}
	parts := strings.Split(sealed, ":")
	if len(parts) != 4 || parts[0] != sealVersion || parts[1] == "" || parts[2] == "" || parts[3] == "" {
		return "", errors.New("unrecognised sealed value")
	}
	enc := base64.StdEncoding
	iv, err := enc.DecodeString(parts[1])
	if err != nil {
		return "", err
	}
	tag, err := enc.DecodeString(parts[2])
	if err != nil {
		return "", err
	}
	ciphertext, err := enc.DecodeString(parts[3])
	if err != nil {
		return "", err
	}
	block, err := aes.NewCipher(b.key)
	if err != nil {
		return "", err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return "", err
	}
	plain, err := gcm.Open(nil, iv, append(ciphertext, tag...), nil)
	if err != nil {
		return "", err
	}
	return string(plain), nil
}
