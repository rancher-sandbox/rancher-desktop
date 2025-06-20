package certificates_test

import (
	"bytes"
	"crypto/x509"
	"encoding/pem"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/rancher-sandbox/rancher-desktop/src/go/wsl-helper/pkg/certificates"
)

// Test that we don't use memory that we don't own
func TestGetSystemCertificates_UseAfterFree(t *testing.T) {
	var certs []*x509.Certificate
	ch, err := certificates.GetSystemCertificates("CA")
	require.NoError(t, err, "failed to get CA certificates")
	for entry := range ch {
		if assert.NoError(t, err, entry.Err) {
			certs = append(certs, entry.Cert)
		}
	}
	ch, err = certificates.GetSystemCertificates("ROOT")
	require.NoError(t, err, "failed to get ROOT certificates")
	for entry := range ch {
		if assert.NoError(t, err, entry.Err) {
			certs = append(certs, entry.Cert)
		}
	}

	// By this point, both channels have been closed, which also means we have
	// closed both cert stores.
	for _, cert := range certs {
		buf := bytes.Buffer{}
		block := &pem.Block{Type: "CERTIFICATE", Bytes: cert.Raw}
		err = pem.Encode(&buf, block)
		if assert.NoError(t, err, "Failed to encode certificate") {
			// Look for invalid certificates:
			// - A line of all A (nulls)
			// - A line with 0xFEEEFEEE (HeapAlloc freed marker)
			output := buf.String()
			assert.NotContains(t, output, "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA", "encoded cert contains nulls")
			assert.NotContains(t, output, "7v7u/u7+7v7u/u7+7v7u/u7+7v7u/u7+7v7u/u7+7v7u/u7+7v7u/u7+7v7u/u7+", "encoded cert contains FEEEFEEE")
		}
	}
}
