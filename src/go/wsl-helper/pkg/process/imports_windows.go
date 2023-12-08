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

import "golang.org/x/sys/windows"

var (
	kernel32Dll           = windows.NewLazySystemDLL("kernel32.dll")
	openProcess           = kernel32Dll.NewProc("OpenProcess")
	attachConsole         = kernel32Dll.NewProc("AttachConsole")
	freeConsole           = kernel32Dll.NewProc("FreeConsole")
	setConsoleCtrlHandler = kernel32Dll.NewProc("SetConsoleCtrlHandler")
)
