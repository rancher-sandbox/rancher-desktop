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
	"unsafe"

	"golang.org/x/sys/windows"
)

type messageType uintptr

//nolint:stylecheck // Win32 constants
const (
	INSTALLMESSAGE_INFO        messageType = 0x04000000
	INSTALLMESSAGE_ACTIONSTART messageType = 0x08000000
)

func submitMessage(hInstall MSIHANDLE, message messageType, data []string) error {
	record, _, _ := msiCreateRecord.Call(uintptr(len(data) - 1))
	if record == 0 {
		return fmt.Errorf("failed to create record")
	}
	defer func() { _, _, _ = msiCloseHandle.Call(record) }()
	for i, item := range data {
		buf, err := windows.UTF16PtrFromString(item)
		if err != nil {
			return err
		}
		_, _, _ = msiRecordSetStringW.Call(record, uintptr(i), uintptr(unsafe.Pointer(buf)))
	}
	_, _, _ = msiProcessMessage.Call(uintptr(hInstall), uintptr(message), record)
	return nil
}

// msiWriter is an io.Writer that emits to Windows Installer's logging.
type msiWriter struct {
	hInstall MSIHANDLE
}

func (w *msiWriter) Write(message []byte) (int, error) {
	// We always set up a record where *0 is just "[1]" to avoid issues if
	// the message contains formatting; this is analogous to calling
	// `Sprintf("%s", ...)``
	data := []string{"[1]", strings.TrimRight(string(message), "\r\n")}
	err := submitMessage(w.hInstall, INSTALLMESSAGE_INFO, data)
	if err != nil {
		return 0, err
	}
	return len(message), nil
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
	_, _, _ = msiSetPropertyW.Call(
		uintptr(hInstall),
		uintptr(unsafe.Pointer(nameBuf)),
		uintptr(unsafe.Pointer(valueBuf)),
	)
	return nil
}
