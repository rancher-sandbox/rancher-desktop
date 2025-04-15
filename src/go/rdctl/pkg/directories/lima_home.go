/*
Copyright © 2025 SUSE LLC

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
	"fmt"
	"os"
	"path/filepath"
	"runtime"
)

func SetupLimaHome(appHome string) error {
	candidatePath := filepath.Join(appHome, "lima")
	stat, err := os.Stat(candidatePath)
	if err != nil {
		return fmt.Errorf("can't find the lima-home directory at %q: %w", candidatePath, err)
	}
	if !stat.Mode().IsDir() {
		return fmt.Errorf("path %q exists but isn't a directory", candidatePath)
	}
	return os.Setenv("LIMA_HOME", candidatePath)
}

func GetLimactlPath() (string, error) {
	execPath, err := os.Executable()
	if err != nil {
		return "", err
	}
	execPath, err = filepath.EvalSymlinks(execPath)
	if err != nil {
		return "", err
	}
	result := filepath.Join(filepath.Dir(filepath.Dir(execPath)), "lima", "bin", "limactl")
	if runtime.GOOS == "windows" {
		result += ".exe"
	}
	return result, nil
}
