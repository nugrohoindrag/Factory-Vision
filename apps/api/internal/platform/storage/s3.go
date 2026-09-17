package storage

import (
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"sort"
	"strings"
	"time"
)

// S3Options configure the S3-compatible store — MinIO on a self-hosted
// install, or a managed bucket. Path-style addressing is on by default:
// MinIO addresses buckets by path, and virtual-host addressing fails
// against it in a way that looks like a DNS problem.
type S3Options struct {
	Bucket, Region, Endpoint, AccessKey, SecretKey string
	ForcePathStyle                                 bool
}

// S3 is a minimal Signature V4 client for the four object operations the
// store needs. Written on the standard library rather than the AWS SDK: the
// four requests are simple, and the SDK's module graph is not.
type S3 struct {
	opt    S3Options
	client *http.Client
	now    func() time.Time
}

// NewS3 builds the client.
func NewS3(o S3Options) *S3 {
	return &S3{opt: o, client: &http.Client{Timeout: 60 * time.Second}, now: time.Now}
}

// Kind is "s3".
func (s *S3) Kind() string { return "s3" }

func (s *S3) objectURL(key string) (*url.URL, string) {
	endpoint := s.opt.Endpoint
	if endpoint == "" {
		endpoint = "https://s3." + s.opt.Region + ".amazonaws.com"
	}
	u, err := url.Parse(endpoint)
	if err != nil || u.Host == "" {
		u = &url.URL{Scheme: "https", Host: endpoint}
	}
	var path string
	if s.opt.ForcePathStyle || s.opt.Endpoint != "" {
		path = "/" + s.opt.Bucket
	} else {
		u.Host = s.opt.Bucket + "." + u.Host
	}
	if key != "" {
		path += "/" + key
	}
	if path == "" {
		path = "/"
	}
	u.Path = path
	return u, path
}

// uriEncode is the SigV4 canonical URI encoding (every byte but the
// unreserved set, and "/" kept as a separator).
func uriEncode(s string, keepSlash bool) string {
	var b strings.Builder
	for i := 0; i < len(s); i++ {
		c := s[i]
		switch {
		case (c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z') || (c >= '0' && c <= '9') || c == '-' || c == '_' || c == '.' || c == '~':
			b.WriteByte(c)
		case c == '/' && keepSlash:
			b.WriteByte(c)
		default:
			fmt.Fprintf(&b, "%%%02X", c)
		}
	}
	return b.String()
}

func hmacSHA256(key []byte, data string) []byte {
	h := hmac.New(sha256.New, key)
	h.Write([]byte(data))
	return h.Sum(nil)
}

func sha256Hex(b []byte) string {
	sum := sha256.Sum256(b)
	return hex.EncodeToString(sum[:])
}

// sign adds the SigV4 Authorization header (AWS4-HMAC-SHA256, s3 service).
func (s *S3) sign(req *http.Request, path string, payloadHash string) {
	t := s.now().UTC()
	amzDate := t.Format("20060102T150405Z")
	dateStamp := t.Format("20060102")
	req.Header.Set("x-amz-date", amzDate)
	req.Header.Set("x-amz-content-sha256", payloadHash)
	req.Header.Set("host", req.URL.Host)

	// Canonical headers: every header on the request, lower-cased and sorted.
	names := []string{"host"}
	for name := range req.Header {
		if lower := strings.ToLower(name); lower != "host" {
			names = append(names, lower)
		}
	}
	sort.Strings(names)
	var canonicalHeaders strings.Builder
	for _, n := range names {
		v := req.Header.Get(n)
		if n == "host" {
			v = req.URL.Host
		}
		canonicalHeaders.WriteString(n + ":" + strings.TrimSpace(v) + "\n")
	}
	signedHeaders := strings.Join(names, ";")

	canonicalRequest := strings.Join([]string{req.Method, uriEncode(path, true), "", canonicalHeaders.String(), signedHeaders, payloadHash}, "\n")
	scope := dateStamp + "/" + s.opt.Region + "/s3/aws4_request"
	stringToSign := strings.Join([]string{"AWS4-HMAC-SHA256", amzDate, scope, sha256Hex([]byte(canonicalRequest))}, "\n")

	kDate := hmacSHA256([]byte("AWS4"+s.opt.SecretKey), dateStamp)
	kRegion := hmacSHA256(kDate, s.opt.Region)
	kService := hmacSHA256(kRegion, "s3")
	kSigning := hmacSHA256(kService, "aws4_request")
	signature := hex.EncodeToString(hmacSHA256(kSigning, stringToSign))
	req.Header.Set("Authorization", fmt.Sprintf("AWS4-HMAC-SHA256 Credential=%s/%s, SignedHeaders=%s, Signature=%s", s.opt.AccessKey, scope, signedHeaders, signature))
}

func (s *S3) do(ctx context.Context, method, key string, body []byte, contentType string) (*http.Response, error) {
	u, path := s.objectURL(key)
	var reader io.Reader
	if body != nil {
		reader = bytes.NewReader(body)
	}
	req, err := http.NewRequestWithContext(ctx, method, u.String(), reader)
	if err != nil {
		return nil, err
	}
	if body != nil {
		req.ContentLength = int64(len(body))
	}
	if contentType != "" {
		req.Header.Set("content-type", contentType)
	}
	s.sign(req, path, sha256Hex(body))
	req.Header.Del("host")
	return s.client.Do(req)
}

func drain(resp *http.Response) string {
	b, _ := io.ReadAll(io.LimitReader(resp.Body, 4096))
	resp.Body.Close()
	return strings.TrimSpace(string(b))
}

// Put uploads the object.
func (s *S3) Put(ctx context.Context, key string, body []byte, contentType string) (int, error) {
	if err := AssertSafeKey(key); err != nil {
		return 0, err
	}
	resp, err := s.do(ctx, http.MethodPut, key, body, contentType)
	if err != nil {
		return 0, err
	}
	if resp.StatusCode/100 != 2 {
		return 0, fmt.Errorf("s3 put %s: HTTP %d %s", key, resp.StatusCode, drain(resp))
	}
	drain(resp)
	return len(body), nil
}

// Get downloads the object; nil when it does not exist.
func (s *S3) Get(ctx context.Context, key string) ([]byte, error) {
	if err := AssertSafeKey(key); err != nil {
		return nil, err
	}
	resp, err := s.do(ctx, http.MethodGet, key, nil, "")
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode == http.StatusNotFound {
		return nil, nil
	}
	if resp.StatusCode/100 != 2 {
		return nil, fmt.Errorf("s3 get %s: HTTP %d %s", key, resp.StatusCode, drain(resp))
	}
	return io.ReadAll(resp.Body)
}

// Remove deletes the object; 404 is success, as on S3 itself.
func (s *S3) Remove(ctx context.Context, key string) error {
	if err := AssertSafeKey(key); err != nil {
		return err
	}
	resp, err := s.do(ctx, http.MethodDelete, key, nil, "")
	if err != nil {
		return err
	}
	if resp.StatusCode/100 != 2 && resp.StatusCode != http.StatusNotFound {
		return fmt.Errorf("s3 delete %s: HTTP %d %s", key, resp.StatusCode, drain(resp))
	}
	drain(resp)
	return nil
}

// Exists heads the object.
func (s *S3) Exists(ctx context.Context, key string) (bool, error) {
	if err := AssertSafeKey(key); err != nil {
		return false, err
	}
	resp, err := s.do(ctx, http.MethodHead, key, nil, "")
	if err != nil {
		return false, err
	}
	drain(resp)
	if resp.StatusCode == http.StatusNotFound {
		return false, nil
	}
	if resp.StatusCode/100 != 2 {
		return false, fmt.Errorf("s3 head %s: HTTP %d", key, resp.StatusCode)
	}
	return true, nil
}

// Check heads the bucket.
func (s *S3) Check(ctx context.Context) (bool, string) {
	resp, err := s.do(ctx, http.MethodHead, "", nil, "")
	where := s.opt.Endpoint
	if where == "" {
		where = s.opt.Region
	}
	if err != nil {
		return false, fmt.Sprintf("bucket %s tidak dapat diakses: %s", s.opt.Bucket, err)
	}
	drain(resp)
	if resp.StatusCode/100 != 2 {
		return false, fmt.Sprintf("bucket %s tidak dapat diakses: HTTP %d", s.opt.Bucket, resp.StatusCode)
	}
	return true, fmt.Sprintf("s3: %s/%s", where, s.opt.Bucket)
}
