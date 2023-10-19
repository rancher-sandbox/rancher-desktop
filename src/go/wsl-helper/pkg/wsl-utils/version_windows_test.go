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

package wslutils

import (
	"context"
	"fmt"
	"io"
	"os"
	"os/exec"
	"strconv"
	"strings"
	"testing"

	"github.com/sirupsen/logrus"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

const (
	// Test with a package that's more likely to exist across all machines
	testPackageFamily     = "Microsoft.LockApp_cw5n1h2txyewy" // spellcheck-ignore-line
	testPackageNamePrefix = "Microsoft.LockApp_"
)

func TestGetPackageNames(t *testing.T) {
	names, err := getPackageNames(testPackageFamily)
	require.NoError(t, err, "Error getting package names")
	require.NotEmpty(t, names, "Failed to get any packages")
	for _, name := range names {
		assert.True(
			t,
			strings.HasPrefix(name, testPackageNamePrefix),
			fmt.Sprintf("Unexpected package name %s", name))
	}
}

func TestGetPackageVersion(t *testing.T) {
	packageNames, err := getPackageNames(testPackageFamily)
	require.NoError(t, err, "could not get package names")
	require.NotEmpty(t, packageNames)
	packageName := packageNames[0]
	version, err := getPackageVersion(packageName)
	require.NoError(t, err)
	require.NotNil(t, version)
	// The package major version is always at least 10 (for Windows 10)
	assert.GreaterOrEqual(t, version.Major, uint16(10), "Unexpected version %s", version)
}

// TestWithExitCode is a dummy test function to let us exit with a given exit
// code.  See TestIsInboxWSLInstalled/not_installed.
func TestWithExitCode(t *testing.T) {
	codeStr := os.Getenv("TEST_EXIT_CODE_VALUE")
	code, err := strconv.ParseInt(codeStr, 10, 8)
	if err != nil {
		return
	}
	os.Exit(int(code))
}

// mockRun overrides the WSL runner to use the given function.
func mockRun(ctx context.Context, fn func(context.Context, ...string) error) (context.Context, *wslRunnerImpl) {
	runner := &wslRunnerImpl{
		stdout: io.Discard,
		stderr: io.Discard,
		runFn:  fn,
	}
	return context.WithValue(ctx, &kWSLExeOverride, func() WSLRunner { return runner }), runner
}

func TestIsInboxWSLInstalled(t *testing.T) {
	logger := logrus.New()
	logger.SetOutput(io.Discard)

	t.Run("not installed", func(t *testing.T) {
		ctx, _ := mockRun(context.Background(), func(ctx context.Context, args ...string) error {
			assert.EqualValues(t, []string{"--status"}, args)
			// We want to mock an executable that exits with `wslExitNotInstalled`.
			// We do this by running ourselves, but using the TestWithExitCode
			// function above to return a fixed value passed through the
			// environment.
			cmd := exec.CommandContext(ctx, os.Args[0], "-test.run", "^TestWithExitCode$")
			cmd.Env = append(cmd.Env, fmt.Sprintf("TEST_EXIT_CODE_VALUE=%d", wslExitNotInstalled))
			return cmd.Run()
		})
		// Use a random GUID here
		ctx = context.WithValue(ctx, &kUpgradeCodeOverride, "{60486CC7-CD7A-4514-9E88-7F21E8A81679}")
		hasWSL, hasKernel, err := isInboxWSLInstalled(ctx, logrus.NewEntry(logger))
		assert.NoError(t, err)
		assert.False(t, hasWSL, "WSL should not be installed")
		assert.False(t, hasKernel, "kernel should not be installed")
	})
	t.Run("installed without kernel", func(t *testing.T) {
		var ctx context.Context
		var runner *wslRunnerImpl
		ctx, runner = mockRun(context.Background(), func(ctx context.Context, args ...string) error {
			assert.EqualValues(t, []string{"--status"}, args)
			// When WSL (inbox) is installed but no kernel, `wsl --status`
			// returns with exit code 0.
			for _, line := range []string{
				"Default Version: 2",
				"",
				"... Something about updates...",
				"The WSL 2 kernel file is not found. To update or restore the kernel please run 'wsl --update'.",
				"",
			} {
				_, err := io.WriteString(runner.stdout, line+"\r\n")
				assert.NoError(t, err)
			}
			return nil
		})
		// Use a random GUID here
		ctx = context.WithValue(ctx, &kUpgradeCodeOverride, "{0C32EDDD-2674-4F32-B415-B715AF90BE74}")
		hasWSL, hasKernel, err := isInboxWSLInstalled(ctx, logrus.NewEntry(logger))
		assert.NoError(t, err)
		assert.True(t, hasWSL, "WSL should be installed")
		assert.False(t, hasKernel, "kernel should not be installed")
	})
	t.Run("installed with kernel", func(t *testing.T) {
		var ctx context.Context
		var runner *wslRunnerImpl
		ctx, runner = mockRun(context.Background(), func(ctx context.Context, args ...string) error {
			assert.EqualValues(t, []string{"--status"}, args)
			io.WriteString(runner.stdout, "Hello world\r\n")
			return nil
		})
		// Use the upgrade code for "Microsoft Update Health Tools", which is
		// automatically installed from Windows Update.
		ctx = context.WithValue(ctx, &kUpgradeCodeOverride, "{2E5106FD-42A1-4BBE-9C29-7E1D34CB79A1}")
		hasWSL, hasKernel, err := isInboxWSLInstalled(ctx, logrus.NewEntry(logger))
		assert.NoError(t, err)
		assert.True(t, hasWSL, "WSL should be installed")
		assert.True(t, hasKernel, "kernel should be installed")
	})
}
