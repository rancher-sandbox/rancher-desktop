package shell

import (
	"bytes"
	"context"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"runtime"
	"slices"
	"strings"

	"github.com/sirupsen/logrus"
	"golang.org/x/text/encoding/unicode"

	"github.com/rancher-sandbox/rancher-desktop/src/go/rdctl/pkg/command"
	"github.com/rancher-sandbox/rancher-desktop/src/go/rdctl/pkg/directories"
	"github.com/rancher-sandbox/rancher-desktop/src/go/rdctl/pkg/lima"
	"github.com/rancher-sandbox/rancher-desktop/src/go/rdctl/pkg/paths"
	"github.com/rancher-sandbox/rancher-desktop/src/go/rdctl/pkg/utils"
	"github.com/rancher-sandbox/rancher-desktop/src/go/rdctl/pkg/wsl"
)

// Spawn a command that, when run, will be executed in the VM with the given
// arguments.
func SpawnCommand(ctx context.Context, args ...string) (*exec.Cmd, error) {
	commandName, err := directories.GetLimactlPath()
	if err != nil {
		return nil, err
	}

	if runtime.GOOS == "windows" {
		distroNames := []string{wsl.DistributionName}
		found := false

		if _, err = os.Stat(commandName); err == nil {
			// If limactl is available, try the lima distribution first.
			distroNames = append([]string{lima.InstanceFullName}, distroNames...)
		}

		for _, distroName := range distroNames {
			err = assertWSLIsRunning(ctx, distroName)
			if err == nil {
				commandName = "wsl"
				args = append([]string{
					"--distribution", distroName,
					"--exec", "/usr/local/bin/wsl-exec",
				}, args...)
				found = true
				break
			}
		}

		if !found {
			return nil, err
		}
	} else {
		p, err := paths.GetPaths()
		if err != nil {
			return nil, err
		}
		if err := directories.SetupLimaHome(p.AppHome); err != nil {
			return nil, err
		}
		if err := setupPathEnvVar(p); err != nil {
			return nil, err
		}
		if err := checkLimaIsRunning(ctx, commandName); err != nil {
			return nil, err
		}
		args = append([]string{"shell", lima.InstanceName}, args...)
	}
	return exec.CommandContext(ctx, commandName, args...), nil
}

// Set up the PATH environment variable for limactl.
func setupPathEnvVar(p *paths.Paths) error {
	if runtime.GOOS != "windows" {
		// This is only needed on Windows.
		return nil
	}
	msysDir := filepath.Join(utils.GetParentDir(p.Resources, 2), "msys")
	pathList := filepath.SplitList(os.Getenv("PATH"))
	if slices.Contains(pathList, msysDir) {
		return nil
	}
	pathList = append([]string{msysDir}, pathList...)
	return os.Setenv("PATH", strings.Join(pathList, string(os.PathListSeparator)))
}

func checkLimaIsRunning(ctx context.Context, commandName string) error {
	var stdout bytes.Buffer
	var stderr bytes.Buffer

	const desiredState = "Running"

	//nolint:gosec // The command name is auto-detected, and the instance name is constant.
	cmd := exec.CommandContext(ctx, commandName, "ls", lima.InstanceName, "--format", "{{.Status}}")
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr
	if err := cmd.Run(); err != nil {
		logrus.Errorf("Failed to run %q: %s\n", cmd, err)
		return command.NewFatalError("", 1)
	}
	limaState := strings.TrimRight(stdout.String(), "\n")
	// We can do an equals check here because we should only have received the status for VM 0
	if limaState == desiredState {
		return nil
	}
	if limaState != "" {
		return command.NewVMStateError(ctx, desiredState, limaState)
	}
	errorMsg := stderr.String()
	if strings.Contains(errorMsg, fmt.Sprintf("No instance matching %s found.", lima.InstanceName)) {
		return command.NewVMStateError(ctx, desiredState, "")
	} else if errorMsg != "" {
		return command.NewFatalError(errorMsg, 1)
	}
	return command.NewFatalError("Underlying limactl check failed with no output.", 1)
}

// Check that WSL is running the given distribution; if not, an error will be
// returned with a message suitable for printing to the user.
func assertWSLIsRunning(ctx context.Context, distroName string) error {
	// Ignore error messages; none are expected here
	rawOutput, err := exec.CommandContext(ctx, "wsl", "--list", "--verbose").CombinedOutput()
	if err != nil {
		return fmt.Errorf("failed to run 'wsl --list --verbose': %w", err)
	}
	decoder := unicode.UTF16(unicode.LittleEndian, unicode.IgnoreBOM).NewDecoder()
	output, err := decoder.Bytes(rawOutput)
	if err != nil {
		return fmt.Errorf("failed to read WSL output ([% q]...); error: %w", rawOutput[:12], err)
	}
	actualState := ""
	for _, line := range regexp.MustCompile(`\r?\n`).Split(string(output), -1) {
		fields := regexp.MustCompile(`\s+`).Split(strings.TrimLeft(line, " \t"), -1)
		if fields[0] == "*" {
			fields = fields[1:]
		}
		if len(fields) >= 2 && fields[0] == distroName {
			actualState = fields[1]
			break
		}
	}
	const desiredState = "Running"
	if actualState == desiredState {
		return nil
	}

	return command.NewVMStateError(ctx, desiredState, actualState)
}
