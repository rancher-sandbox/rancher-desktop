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

// IsWSLInstalled is a wrapper around IsWSLInstalledImpl; this is the stub to
// be exported in the DLL.  This only exists because code analysis doesn't work
// as well in cgo files.
//
//export IsWSLInstalled
func IsWSLInstalled(hInstall C.ulong) C.ulong {
	return C.ulong(IsWSLInstalledImpl(MSIHANDLE(hInstall)))
}

// InstallWindowsFeature is a wrapper around InstallWindowsFeature; this is the
// stub to be exported in the DLL.  This only exists because code analysis
// doesn't work as well in cgo files.
//
//export InstallWindowsFeature
func InstallWindowsFeature(hInstall C.ulong) C.ulong {
	return C.ulong(InstallWindowsFeatureImpl(MSIHANDLE(hInstall)))
}

// InstallWSL is a wrapper around InstallWSLImpl; this is the stub to be
// exported in the DLL.  This only exists because code analysis doesn't work as
// well in cgo files.
//
//export InstallWSL
func InstallWSL(hInstall C.ulong) C.ulong {
	return C.ulong(InstallWSLImpl(MSIHANDLE(hInstall)))
}
