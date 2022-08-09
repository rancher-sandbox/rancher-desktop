/*
Copyright © 2021 SUSE LLC

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
package process

import (
	"fmt"

	"github.com/sirupsen/logrus"
	"golang.org/x/sys/windows"
)

var (
	kernel32Dll = windows.MustLoadDLL("Kernel32.dll")
)

// WaitPid waits for the process with the given PID to exit before returning.
func WaitPid(pid uint32) error {
	logEntry := logrus.WithField("pid", pid)
	logEntry.Trace("trying to wait for process")
	openProcess, err := kernel32Dll.FindProc("OpenProcess")
	if err != nil {
		return fmt.Errorf("could not find OpenProcess: %w", err)
	}
	hProcRaw, _, err := openProcess.Call(
		windows.SYNCHRONIZE,
		0,
		uintptr(pid),
	)
	if hProcRaw == 0 {
		return fmt.Errorf("could not get handle to process %d: %w", pid, err)
	}
	hProc := windows.Handle(hProcRaw)
	defer windows.CloseHandle(hProc)

	logEntry.Trace("waiting for process")
	result, err := windows.WaitForSingleObject(hProc, windows.INFINITE)
	if err != nil {
		return fmt.Errorf("failed to wait for process %d: %w", pid, err)
	}
	logEntry.WithField("result", result).Trace("finished waiting for process")
	return nil
}
