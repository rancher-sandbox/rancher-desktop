/*
Copyright © 2022 SUSE LLC

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
	"os/exec"
	"path"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
)

func SetupLimaHome(appHome string) error {
	candidatePath := path.Join(appHome, "lima")
	stat, err := os.Stat(candidatePath)
	if err != nil {
		return fmt.Errorf("can't find the lima-home directory at %q", candidatePath)
	}
	if !stat.Mode().IsDir() {
		return fmt.Errorf("path %q exists but isn't a directory", candidatePath)
	}
	os.Setenv("LIMA_HOME", candidatePath)
	return nil
}

func getOSMajorVersion() (int, error) {
	// syscall.Uname isn't available on macOS, so we need to shell out.
	// This is only called once by `rdctl shutdown` and once by `rdctl shell` so there's no need to memoize the result
	version, err := exec.Command("uname", "-r").CombinedOutput()
	if err != nil {
		return -1, err
	}
	before, _, found := strings.Cut(string(version), ".")
	if !found || len(before) == 0 {
		return -1, fmt.Errorf("Expected a version string, got: %q", string(version))
	}
	return strconv.Atoi(before)
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
	if runtime.GOOS == "darwin" {
		majorVersion, err := getOSMajorVersion()
		if err == nil && majorVersion >= 22 {
			// https://en.wikipedia.org/wiki/MacOS_version_history: maps darwin versions to macOS release version numbers and names
			// macOS 13 | Ventura | 22
			return path.Join(path.Dir(path.Dir(execPath)), "lima", "bin", "limactl.ventura"), nil
		}
	}
	return path.Join(path.Dir(path.Dir(execPath)), "lima", "bin", "limactl"), nil
}
