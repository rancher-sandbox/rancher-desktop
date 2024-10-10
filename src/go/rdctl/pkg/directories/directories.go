/*
Copyright © 2024 SUSE LLC

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

package directories

import (
	"os"
	"path/filepath"
	"runtime"
)

// GetApplicationDirectory returns the installation directory of the application.
func GetApplicationDirectory() (string, error) {
	exePathWithSymlinks, err := os.Executable()
	if err != nil {
		return "", err
	}

	exePath, err := filepath.EvalSymlinks(exePathWithSymlinks)
	if err != nil {
		return "", err
	}

	platform := runtime.GOOS
	if runtime.GOOS == "windows" {
		// On Windows, we use "win32" instead of "windows".
		platform = "win32"
	}

	// Given the path to the exe, find its directory, and drop the
	// "resources\win32\bin" suffix (possibly with another "resources" in front).
	// On mac, we need to drop "Contents/Resources/resources/darwin/bin".
	resultDir := filepath.Dir(exePath)
	for _, part := range []string{"bin", platform, "resources", "Resources", "Contents"} {
		for filepath.Base(resultDir) == part {
			resultDir = filepath.Dir(resultDir)
		}
	}
	return resultDir, nil
}
