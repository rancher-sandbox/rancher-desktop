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

import "C"

func main() {
	// DllMain is not used
}

// DetectWSL is a wrapper around DetectWSLImpl; this is the stub to be exported
// in the DLL.  This only exists to limit cgo to this file so that editing on a
// machine that requires cross compilation can avoid needing a cross cgo
// toolchain.
//
//export DetectWSL
func DetectWSL(hInstall C.ulong) C.ulong {
	return C.ulong(DetectWSLImpl(MSIHANDLE(hInstall)))
}

// UpdateWSL is a wrapper around UpdateWSLImpl; this is the stub to be exported
// in the DLL.  This only exists to limit cgo to this file so that editing on a
// machine that requires cross compilation can avoid needing a cross cgo
// toolchain.
//
//export UpdateWSL
func UpdateWSL(hInstall C.ulong) C.ulong {
	return C.ulong(UpdateWSLImpl(MSIHANDLE(hInstall)))
}
