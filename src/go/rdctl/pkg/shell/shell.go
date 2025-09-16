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
			// We did not find a running distribution that we can use.
			// No further output wanted, so just exit with the desired status.
			fmt.Fprintf(os.Stderr, "%s", err)
			os.Exit(1)
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
		if !checkLimaIsRunning(ctx, commandName) {
			// No further output wanted, so just exit with the desired status.
			os.Exit(1)
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

const restartDirective = "Either run 'rdctl start' or start the Rancher Desktop application first"

func checkLimaIsRunning(ctx context.Context, commandName string) bool {
	var stdout bytes.Buffer
	var stderr bytes.Buffer

	//nolint:gosec // The command name is auto-detected, and the instance name is constant.
	cmd := exec.CommandContext(ctx, commandName, "ls", lima.InstanceName, "--format", "{{.Status}}")
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr
	if err := cmd.Run(); err != nil {
		logrus.Errorf("Failed to run %q: %s\n", cmd, err)
		return false
	}
	limaState := strings.TrimRight(stdout.String(), "\n")
	// We can do an equals check here because we should only have received the status for VM 0
	if limaState == "Running" {
		return true
	}
	if limaState != "" {
		fmt.Fprintf(os.Stderr,
			"The Rancher Desktop VM needs to be in state \"Running\" in order to execute 'rdctl shell', but it is currently in state %q.\n%s.\n", limaState, restartDirective)
		return false
	}
	errorMsg := stderr.String()
	if strings.Contains(errorMsg, fmt.Sprintf("No instance matching %s found.", lima.InstanceName)) {
		logrus.Errorf("The Rancher Desktop VM needs to be created.\n%s.\n", restartDirective)
	} else if errorMsg != "" {
		fmt.Fprintln(os.Stderr, errorMsg)
	} else {
		fmt.Fprintln(os.Stderr, "Underlying limactl check failed with no output.")
	}
	return false
}

// Check that WSL is running the given distribution; if not, an error will be
// returned with a message suitable for printing to the user.
func assertWSLIsRunning(ctx context.Context, distroName string) error {
	// Ignore error messages; none are expected here
	rawOutput, err := exec.CommandContext(ctx, "wsl", "--list", "--verbose").CombinedOutput()
	if err != nil {
		return fmt.Errorf("failed to run `wsl --list --verbose: %w", err)
	}
	decoder := unicode.UTF16(unicode.LittleEndian, unicode.IgnoreBOM).NewDecoder()
	output, err := decoder.Bytes(rawOutput)
	if err != nil {
		return fmt.Errorf("failed to read WSL output ([% q]...); error: %w", rawOutput[:12], err)
	}
	isListed := false
	targetState := ""
	for _, line := range regexp.MustCompile(`\r?\n`).Split(string(output), -1) {
		fields := regexp.MustCompile(`\s+`).Split(strings.TrimLeft(line, " \t"), -1)
		if fields[0] == "*" {
			fields = fields[1:]
		}
		if len(fields) >= 2 && fields[0] == distroName {
			isListed = true
			targetState = fields[1]
			break
		}
	}
	const desiredState = "Running"
	if targetState == desiredState {
		return nil
	}
	if !isListed {
		return fmt.Errorf("the Rancher Desktop WSL distribution needs to be running in order to execute 'rdctl shell', but it currently is not.\n%s", restartDirective)
	}
	return fmt.Errorf("the Rancher Desktop WSL distribution needs to be in state %q in order to execute 'rdctl shell', but it is currently in state %q.\n%s", desiredState, targetState, restartDirective)
}
