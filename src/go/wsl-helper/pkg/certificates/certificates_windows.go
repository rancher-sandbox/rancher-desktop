/*
Copyright © 2023 SUSE LLC

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

	http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
*/

// Package certificates is used to enumerate the system certificate authorities
// on Windows.
package certificates

import (
	"crypto/x509"
	"errors"
	"fmt"
	"unsafe"

	"github.com/sirupsen/logrus"
	"golang.org/x/sys/windows"
)

// Entry is one enumeration result; it holds either a valid certificate or an
// error.  They are mutually exclusive.
type Entry struct {
	Cert *x509.Certificate
	Err  error
}

// getCertName returns a string describing the given certificate context.
func getCertName(ctx *windows.CertContext) string {
	length := windows.CertGetNameString(ctx, windows.CERT_NAME_FRIENDLY_DISPLAY_TYPE, 0, unsafe.Pointer(nil), nil, 0)
	if length == 1 {
		return "<error parsing certificate name>"
	}
	buf := make([]uint16, length)
	_ = windows.CertGetNameString(ctx, windows.CERT_NAME_FRIENDLY_DISPLAY_TYPE, 0, unsafe.Pointer(nil), unsafe.SliceData(buf), length)
	return windows.UTF16ToString(buf)
}

// GetSystemCertificates returns the Windows system certificates from the given
// certificate store.  Typical store names are strings like "CA", "Root", "My".
func GetSystemCertificates(storeName string) (<-chan Entry, error) {
	storeNameBytes, err := windows.UTF16PtrFromString(storeName)
	if err != nil {
		return nil, err
	}
	store, err := windows.CertOpenSystemStore(windows.Handle(0), storeNameBytes)
	if err != nil {
		return nil, fmt.Errorf("failed to open store %q: %w", storeName, err)
	}
	ch := make(chan Entry)
	go func() {
		defer close(ch)
		defer func() { _ = windows.CertCloseStore(store, 0) }()
		var certCtx *windows.CertContext
		var err error
		for {
			certCtx, err = windows.CertEnumCertificatesInStore(store, certCtx)
			if err != nil {
				switch {
				case errors.Is(err, windows.ERROR_NO_MORE_FILES):
				case errors.Is(err, windows.Errno(windows.CRYPT_E_NOT_FOUND)):
				default:
					ch <- Entry{Err: fmt.Errorf("error enumerating certificate in %q: %w", storeName, err)}
				}
				break
			}
			// Make a copy of the encoded cert, because the parsed cert may have
			// references to the memory (that isn't owned by the GC) and we'll return
			// it in a channel, so HeapFree() might get called on it before it's used.
			// See #6295 / #6307.
			certData := make([]byte, certCtx.Length)
			copy(certData, unsafe.Slice(certCtx.EncodedCert, certCtx.Length))
			cert, err := x509.ParseCertificate(certData)
			if err != nil {
				// Skip invalid certs
				logrus.Tracef("Skipping invalid certificate %q in %q: %s", getCertName(certCtx), storeName, err)
				continue
			}
			logrus.Tracef("Found cert %q in %q", getCertName(certCtx), storeName)
			ch <- Entry{Cert: cert}
		}
	}()
	return ch, nil
}
