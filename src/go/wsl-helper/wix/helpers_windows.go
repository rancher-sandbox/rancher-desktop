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

package main

import (
	"fmt"
	"strings"
	"sync"
	"unsafe"

	"golang.org/x/sys/windows"
)

const (
	INSTALLMESSAGE_INFO = 0x04000000
)

// msiWriter is an io.Writer that emits to Windows Installer's logging.
type msiWriter struct {
	hInstall MSIHANDLE
	once     sync.Once
	record   uintptr
}

func (w *msiWriter) Write(message []byte) (int, error) {
	var err error
	w.once.Do(func() {
		// We always set up a record where *0 is just "[1]" to avoid issues if
		// the message contains formatting; this is analogous to calling
		// `Sprintf("%s", ...)``
		var buf *uint16
		buf, err = windows.UTF16PtrFromString("[1]")
		if err != nil {
			return
		}
		w.record, _, _ = msiCreateRecord.Call(1)
		_, _, _ = msiRecordSetStringW.Call(w.record, 0, uintptr(unsafe.Pointer(buf)))
	})
	if err != nil {
		return 0, err
	}
	buf, err := windows.UTF16PtrFromString(strings.TrimRight(string(message), "\r\n"))
	if err != nil {
		return 0, err
	}
	_, _, _ = msiRecordSetStringW.Call(
		w.record,
		1,
		uintptr(unsafe.Pointer(buf)),
	)
	_, _, _ = msiProcessMessage.Call(
		uintptr(w.hInstall),
		uintptr(INSTALLMESSAGE_INFO),
		w.record,
	)
	// As an extra debugging helper, also send it on OutputDebugString
	_, _, _ = outputDebugStringW.Call(uintptr(unsafe.Pointer(buf)))
	return len(message), nil
}

func (w *msiWriter) cleanup() {
	if w.record != 0 {
		msiCloseHandle.Call(w.record)
	}
}

// setProperty sets a Windows Installer property to the given value.
func setProperty(hInstall MSIHANDLE, name, value string) error {
	nameBuf, err := windows.UTF16PtrFromString(name)
	if err != nil {
		return fmt.Errorf("failed to encode property name %q: %w", name, err)
	}
	valueBuf, err := windows.UTF16PtrFromString(value)
	if err != nil {
		return fmt.Errorf("failed to encode property value %q: %w", value, err)
	}
	msiSetPropertyW.Call(
		uintptr(hInstall),
		uintptr(unsafe.Pointer(nameBuf)),
		uintptr(unsafe.Pointer(valueBuf)),
	)
	return nil
}
