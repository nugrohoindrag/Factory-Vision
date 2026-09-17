package storage

import (
	"net/http"
	"strings"
	"testing"
	"time"
)

// The GET Object example from the AWS Signature Version 4 documentation
// ("Examples: Signature Calculations in AWS Signature Version 4").
func TestS3SignatureMatchesAWSExample(t *testing.T) {
	s := NewS3(S3Options{Bucket: "examplebucket", Region: "us-east-1", AccessKey: "AKIAIOSFODNN7EXAMPLE", SecretKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY"})
	s.now = func() time.Time { return time.Date(2013, 5, 24, 0, 0, 0, 0, time.UTC) }
	req, _ := http.NewRequest(http.MethodGet, "https://examplebucket.s3.amazonaws.com/test.txt", nil)
	req.Header.Set("range", "bytes=0-9")
	s.sign(req, "/test.txt", sha256Hex(nil))
	auth := req.Header.Get("Authorization")
	want := "Signature=f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41"
	if !strings.HasSuffix(auth, want) {
		t.Fatalf("authorization = %s, want suffix %s", auth, want)
	}
	if !strings.Contains(auth, "SignedHeaders=host;range;x-amz-content-sha256;x-amz-date") {
		t.Fatalf("signed headers: %s", auth)
	}
}

func TestObjectURLPathStyle(t *testing.T) {
	s := NewS3(S3Options{Bucket: "docs", Region: "us-east-1", Endpoint: "http://minio:9000", ForcePathStyle: true})
	u, path := s.objectURL("tenant-a/file.pdf")
	if u.String() != "http://minio:9000/docs/tenant-a/file.pdf" || path != "/docs/tenant-a/file.pdf" {
		t.Fatalf("url = %s path = %s", u, path)
	}
}

func TestAssertSafeKey(t *testing.T) {
	for _, bad := range []string{"", "/abs", "a/../b", "a\\b", "a\x00"} {
		if err := AssertSafeKey(bad); err == nil {
			t.Errorf("%q accepted", bad)
		}
	}
	if err := AssertSafeKey("tenant/doc-1.pdf"); err != nil {
		t.Fatal(err)
	}
}
