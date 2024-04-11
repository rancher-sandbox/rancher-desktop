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

package process

import (
	"fmt"
	"math"
	"unsafe"

	"golang.org/x/sys/windows"
)

//nolint:stylecheck // Win32 constant
const (
	ATTACH_PARENT_PROCESS = math.MaxUint32
)

func Kill(pid int) error {
	if pid < 1 {
		return fmt.Errorf("cannot kill process: invalid pid: %d", pid)
	}

	// Try to re-attach to the default console
	defer func() {
		_, _, _ = freeConsole.Call()
		_, _, _ = attachConsole.Call(ATTACH_PARENT_PROCESS)
	}()

	// Detach from the current console; if this fails (and we stay attached to the
	// current console), AttachConsole() will fail later, so we don't need to
	// check the return value.
	_, _, _ = freeConsole.Call()

	rv, _, err := attachConsole.Call(uintptr(pid))
	if rv == 0 {
		return fmt.Errorf("failed to attach to console: %w", err)
	}
	// Prevent _this_ process from being affected by Ctrl+C (so we exit cleanly).
	// Ignore any errors if this fails.
	_, _, _ = setConsoleCtrlHandler.Call(uintptr(unsafe.Pointer(nil)), 1)

	err = windows.GenerateConsoleCtrlEvent(windows.CTRL_C_EVENT, 0)
	if err != nil {
		return fmt.Errorf("failed to generate Ctrl+C: %w", err)
	}
	return nil
}
