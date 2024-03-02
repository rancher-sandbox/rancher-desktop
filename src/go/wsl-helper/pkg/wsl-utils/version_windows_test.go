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
	"bytes"
	"context"
	"encoding/json"
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
	"golang.org/x/sys/windows"
)

func TestGetPackageNames(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	t.Cleanup(cancel)

	t.Run("valid package family", func(t *testing.T) {
		// Get a random package family
		command := `Get-AppxPackage | Select-Object -First 1 -ExpandProperty PackageFamilyName`
		output, err := runPowerShell(ctx, command)
		if err != nil {
			t.Skipf("Failed to get sample family, skipping test: %s", err)
		}
		family := strings.TrimSpace(output.String())

		// Get all packages in that family; not that we can't pipe single element
		// arrays (they get flattened to just the element), so we need to pass the
		// list as an argument to ConvertTo-JSON
		command = fmt.Sprintf(strings.NewReplacer("\r", " ", "\n", " ", "\t", " ").Replace(`
		ConvertTo-JSON -InputObject @(
			Get-AppxPackage
			| Where-Object { $_.PackageFamilyName -eq "%s" }
			| Select-Object -ExpandProperty PackageFullName
		)
	`), family)
		output, err = runPowerShell(ctx, command)
		if err != nil {
			t.Skipf("Failed to get packages in family %s, skipping test: %s", family, err)
		}
		var expected []string
		assert.NoErrorf(t, json.Unmarshal(output.Bytes(), &expected), "failed to read package names: %s", output.String())

		names, err := getPackageNames(family)
		require.NoError(t, err, "Error getting package names")
		assert.ElementsMatch(t, expected, names, "Failed to get packages")
	})

	t.Run("invalid package family", func(t *testing.T) {
		_, err := getPackageNames("invalid package family")
		assert.Error(t, err, "should not get packages for invalid family")
	})
}

func TestPackageVersion(t *testing.T) {
	t.Run("UnmarshalText", func(t *testing.T) {
		t.Parallel()
		t.Run("three-part", func(t *testing.T) {
			v := PackageVersion{}
			err := v.UnmarshalText([]byte("1.2.3"))
			assert.NoError(t, err, "failed to unmarshal 1.2.3")
			assert.Equal(t, PackageVersion{Major: 1, Minor: 2, Build: 3}, v)
		})
		t.Run("four-part", func(t *testing.T) {
			v := PackageVersion{}
			err := v.UnmarshalText([]byte("1234.5678.8765.4321"))
			assert.NoError(t, err, "failed to unmarshal 1234.5678.8765.4321")
			assert.Equal(t, PackageVersion{Major: 1234, Minor: 5678, Build: 8765, Revision: 4321}, v)
		})
		t.Run("comma", func(t *testing.T) {
			v := PackageVersion{}
			err := v.UnmarshalText([]byte("1,2,3"))
			assert.NoError(t, err, "failed to unmarshal 1,2,3")
			assert.Equal(t, PackageVersion{Major: 1, Minor: 2, Build: 3}, v)
		})
		t.Run("space", func(t *testing.T) {
			v := PackageVersion{}
			err := v.UnmarshalText([]byte(" 4.5.6"))
			assert.NoError(t, err, "failed to unmarshal <space>4.5.6")
			assert.Equal(t, PackageVersion{Major: 4, Minor: 5, Build: 6}, v)
		})
		t.Run("invalid", func(t *testing.T) {
			v := PackageVersion{}
			err := v.UnmarshalText([]byte("12345"))
			assert.ErrorContains(t, err, `could not parse version "12345"`)
		})
		t.Run("negative", func(t *testing.T) {
			v := PackageVersion{}
			err := v.UnmarshalText([]byte("-1.-2.-3.-4"))
			assert.ErrorContains(t, err, `could not parse version "-1.-2.-3.-4"`)
		})
		t.Run("too-large", func(t *testing.T) {
			v := PackageVersion{}
			err := v.UnmarshalText([]byte("65537.65537.65537.65537"))
			if assert.Error(t, err) {
				assert.ErrorContains(t, err, `version "65537.65537.65537.65537" has invalid major part`)
				assert.ErrorContains(t, err, `version "65537.65537.65537.65537" has invalid minor part`)
				assert.ErrorContains(t, err, `version "65537.65537.65537.65537" has invalid build part`)
				assert.ErrorContains(t, err, `version "65537.65537.65537.65537" has invalid revision part`)
			}
		})
	})
	t.Run("Less", func(t *testing.T) {
		t.Parallel()
		cases := []struct {
			L      string
			R      string
			expect bool
		}{
			{L: "0.0.0", R: "0.0.0", expect: false},
			{L: "0.0.0", R: "0.0.1", expect: true},
			{L: "0.0.2", R: "0.0.1", expect: false},
			{L: "0.0.0", R: "0.1.0", expect: true},
			{L: "0.2.0", R: "0.1.0", expect: false},
			{L: "0.0.0", R: "1.0.0", expect: true},
			{L: "2.0.0", R: "1.0.0", expect: false},
			{L: "0.0.1", R: "0.1.0", expect: true},
			{L: "0.0.1", R: "1.0.0", expect: true},
			{L: "0.1.0", R: "0.0.1", expect: false},
			{L: "1.0.0", R: "0.0.1", expect: false},
		}
		for _, input := range cases {
			input := input
			t.Run(fmt.Sprintf("%s<%s=%v", input.L, input.R, input.expect), func(t *testing.T) {
				var left, right PackageVersion
				assert.NoError(t, left.UnmarshalText([]byte(input.L)))
				assert.NoError(t, right.UnmarshalText([]byte(input.R)))
				assert.Equal(t, input.expect, left.Less(right))
			})
		}
	})
}

func TestGetPackageVersion(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	t.Cleanup(cancel)

	t.Run("valid package", func(t *testing.T) {
		// Get a random package and version
		info := struct {
			PackageFullName string
			Version         *PackageVersion
		}{}
		command := `Get-AppxPackage | Select-Object -First 1 -Property PackageFullName, Version | ConvertTo-JSON`
		output, err := runPowerShell(ctx, command)
		if err != nil {
			t.Skipf("Failed to get sample package, skipping test: %s", err)
		}
		require.NoError(t, json.Unmarshal(output.Bytes(), &info), "failed to get package")
		require.NotNil(t, info.Version, "failed to get package version")

		version, err := getPackageVersion(info.PackageFullName)
		require.NoError(t, err)
		require.NotNil(t, version)
		assert.Equal(t, info.Version, version, "unexpected version")
	})

	t.Run("invalid package", func(t *testing.T) {
		_, err := getPackageVersion("not a valid package name")
		assert.Error(t, err, "should error with invalid package name")
	})
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

// runPowerShell runs the given command with PowerShell, returning standard output.
func runPowerShell(ctx context.Context, command string) (*bytes.Buffer, error) {
	stdout := &bytes.Buffer{}
	stderr := &bytes.Buffer{}
	cmd := exec.CommandContext(ctx, "powershell.exe",
		"-NoLogo", "-NoProfile", "-NonInteractive", "-Command", command)
	cmd.Stdout = stdout
	cmd.Stderr = stderr
	if err := cmd.Run(); err != nil {
		return nil, fmt.Errorf("Failed to run command %q: stdout=%s stderr=%s", command, stdout, stderr)
	}
	return stdout, nil
}

func TestGetAppxVersion(t *testing.T) {
	outputs := map[string]struct {
		lines  []string
		wsl    string
		kernel string
	}{
		"english": {
			lines:  []string{"WSL Version: 2.0.9.0", "Kernel version: 5.15.133.1-1", "WSLg version: 1.0.59", "... stuff"},
			wsl:    "2.0.9.0",
			kernel: "5.15.133.1-1",
		},
		"commas": {
			lines:  []string{"Text 2,0,9,0", "Ignored 5,15,133,1-1", "more,ignored,text"},
			wsl:    "2.0.9.0",
			kernel: "5.15.133.1-1",
		},
		"incomplete": {
			lines:  []string{"W 2.0.9.0", "no kernel version listed"},
			wsl:    "2.0.9.0",
			kernel: "0.0.0",
		},
	}
	logger := logrus.New()
	logger.SetOutput(io.Discard)

	for name, input := range outputs {
		name := name
		input := input
		t.Run(name, func(t *testing.T) {
			ctx, cancel := context.WithCancel(context.Background())
			t.Cleanup(cancel)
			var runner *wslRunnerImpl
			ctx, runner = mockRun(ctx, func(ctx context.Context, s ...string) error {
				assert.ElementsMatch(t, []string{"--version"}, s)
				for _, line := range input.lines {
					_, err := io.WriteString(runner.stdout, line+"\r\n")
					assert.NoError(t, err)
				}
				return nil
			})
			var expectedWSL, expectedKernel PackageVersion
			wsl, kernel, err := getAppxVersion(ctx, logrus.NewEntry(logger))
			assert.NoError(t, err)
			assert.NoError(t, expectedWSL.UnmarshalText([]byte(input.wsl)))
			assert.NoError(t, expectedKernel.UnmarshalText([]byte(input.kernel)))
			assert.Equal(t, &expectedWSL, wsl)
			assert.Equal(t, &expectedKernel, kernel)
		})
	}
}

func TestGetInboxWSLInfo(t *testing.T) {
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
		hasWSL, kernelVersion, err := getInboxWSLInfo(ctx, logrus.NewEntry(logger))
		assert.NoError(t, err)
		assert.False(t, hasWSL, "WSL should not be installed")
		if !assert.Nil(t, kernelVersion, "kernel should not be installed") {
			assert.False(t, PackageVersion{}.Less(*kernelVersion), "kernel should not be installed")
		}
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
		hasWSL, kernelVersion, err := getInboxWSLInfo(ctx, logrus.NewEntry(logger))
		assert.NoError(t, err)
		assert.True(t, hasWSL, "WSL should be installed")
		if !assert.Nil(t, kernelVersion, "kernel should not be installed") {
			assert.False(t, PackageVersion{}.Less(*kernelVersion), "kernel should not be installed")
		}
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
		hasWSL, kernelVersion, err := getInboxWSLInfo(ctx, logrus.NewEntry(logger))
		assert.NoError(t, err)
		assert.True(t, hasWSL, "WSL should be installed")
		if assert.NotNil(t, kernelVersion, "kernel should be installed") {
			assert.True(t, PackageVersion{}.Less(*kernelVersion), "kernel should be installed")
		}
	})
}

func TestGetMSIVersion(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	t.Cleanup(cancel)
	// Find a random installed MSI (via PowerShell), then check that we can get
	// the same version number.
	commandLine := strings.NewReplacer("\r", " ", "\n", " ", "\t", " ").Replace(`
		Get-CimInstance -ClassName Win32_Product -Property IdentifyingNumber, Version
		| Select-Object -First 1
		| ConvertTo-JSON
	`)
	stdout, err := runPowerShell(ctx, commandLine)
	if err != nil {
		t.Skipf("Skipping test, failed to get any installed product: %s", err)
	}
	result := struct {
		IdentifyingNumber string
		Version           *PackageVersion
	}{}
	require.NoError(t, json.Unmarshal(stdout.Bytes(), &result), "Failed to get product info")
	require.NotNil(t, result.Version, "Failed to get product version")

	// Now we have a product code to test again; actually run the function under test.
	productCode, err := windows.UTF16FromString(result.IdentifyingNumber)
	require.NoError(t, err, "Failed to convert product code")
	actualVersion, err := getMSIVersion(productCode)
	require.NoError(t, err, "Failed to get product version")
	assert.Equal(t, result.Version, actualVersion, "Unexpected version")
}
