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
	"context"
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"testing"
)

type rdctlOverrideKeyType struct{}

var rdctlOverrideKey = rdctlOverrideKeyType{}

// OverrideRdctlPath produces a context that will override the path of the rdctl
// executable.  This should only be used in tests.
func OverrideRdctlPath(ctx context.Context, rdctlPath string) context.Context {
	if !testing.Testing() {
		panic("WithOverride can only be used for testing")
	}
	return context.WithValue(ctx, rdctlOverrideKey, rdctlPath)
}

// GetApplicationDirectory returns the installation directory of the application.
func GetApplicationDirectory(ctx context.Context) (string, error) {
	var exePathWithSymlinks string
	var err error
	override, ok := ctx.Value(rdctlOverrideKey).(string)
	if ok {
		exePathWithSymlinks = override
	} else {
		if exePathWithSymlinks, err = os.Executable(); err != nil {
			return "", err
		}
	}

	exePath, err := filepath.EvalSymlinks(exePathWithSymlinks)
	if err != nil {
		return "", err
	}

	if info, err := os.Stat(exePathWithSymlinks); err != nil {
		return "", fmt.Errorf("rdctl executable does not exist: %w", err)
	} else if info.IsDir() {
		return "", fmt.Errorf("rdctl executable is a directory")
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
