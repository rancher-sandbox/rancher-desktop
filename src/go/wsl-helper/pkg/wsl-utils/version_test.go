//go:build windows
// +build windows

package wslutils

import (
	"context"
	"fmt"
	"os"
	"os/exec"
	"strconv"
	"strings"
	"testing"

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

func TestIsInboxWSLInstalled(t *testing.T) {
	t.Run("not installed", func(t *testing.T) {
		overrideFunc := func(ctx context.Context, args ...string) (string, error) {
			assert.EqualValues(t, []string{"--status"}, args)
			// We want to mock an executable that exits with code "50".
			// We do this by running ourselves, but using the TestWithExitCode
			// function above to return a fixed value passed through the
			// environment.
			cmd := exec.CommandContext(ctx, os.Args[0], "-test.run", "^TestWithExitCode$")
			cmd.Env = append(cmd.Env, "TEST_EXIT_CODE_VALUE=50")
			return "", cmd.Run()
		}
		ctx := context.WithValue(context.Background(), &kWSLExeOverride, overrideFunc)
		hasWSL, hasKernel, err := isInboxWSLInstalled(ctx)
		assert.NoError(t, err)
		assert.False(t, hasWSL, "WSL should not be installed")
		assert.False(t, hasKernel, "kernel should not be installed")
	})
	t.Run("installed without kernel", func(t *testing.T) {
		overrideFunc := func(ctx context.Context, args ...string) (string, error) {
			assert.EqualValues(t, []string{"--status"}, args)
			// When WSL (inbox) is installed but no kernel, `wsl --status`
			// returns with exit code 0.
			return strings.Join([]string{
				"Default Version: 2",
				"",
				"... Something about updates...",
				"The WSL 2 kernel file is not found. To update or restore the kernel please run 'wsl --update'.",
				"\r\n",
			}, "\r\n"), nil
		}
		ctx := context.WithValue(context.Background(), &kWSLExeOverride, overrideFunc)
		// Use a random GUID here
		ctx = context.WithValue(ctx, &kUpgradeCodeOverride, "{0C32EDDD-2674-4F32-B415-B715AF90BE74}")
		hasWSL, hasKernel, err := isInboxWSLInstalled(ctx)
		assert.NoError(t, err)
		assert.True(t, hasWSL, "WSL should be installed")
		assert.False(t, hasKernel, "kernel should not be installed")
	})
	t.Run("installed with kernel", func(t *testing.T) {
		overrideFunc := func(ctx context.Context, args ...string) (string, error) {
			assert.EqualValues(t, []string{"--status"}, args)
			return "Hello world\r\n", nil
		}
		ctx := context.WithValue(context.Background(), &kWSLExeOverride, overrideFunc)
		// Use the upgrade code for "Microsoft Update Health Tools", which is
		// installed from Windows Update.
		ctx = context.WithValue(ctx, &kUpgradeCodeOverride, "{2E5106FD-42A1-4BBE-9C29-7E1D34CB79A1}")
		hasWSL, hasKernel, err := isInboxWSLInstalled(ctx)
		assert.NoError(t, err)
		assert.True(t, hasWSL, "WSL should be installed")
		assert.True(t, hasKernel, "kernel should be installed")
	})
}
