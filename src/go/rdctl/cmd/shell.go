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

package cmd

import (
	"bytes"
	"fmt"
	"os"
	"os/exec"
	"path"
	"path/filepath"
	"regexp"
	"runtime"
	"strings"

	"github.com/rancher-sandbox/rancher-desktop/src/go/rdctl/pkg/directories"
	"github.com/sirupsen/logrus"
	"github.com/spf13/cobra"
	"golang.org/x/text/encoding/unicode"
)

// shellCmd represents the shell command
var shellCmd = &cobra.Command{
	Use:   "shell",
	Short: "Run an interactive shell or a command in a Rancher Desktop-managed VM",
	Long: `Run an interactive shell or a command in a Rancher Desktop-managed VM. For example:

> rdctl shell
-- Runs an interactive shell
> rdctl shell ls -CF /tmp
-- Runs 'ls -CF' from /tmp on the VM
> rdctl shell bash -c "cd .. ; pwd"
-- Usual way of running multiple statements on a single call
`,
	DisableFlagParsing: true,
	RunE: func(cmd *cobra.Command, args []string) error {
		// Do manual flag parsing looking to see if we should give help instead.
		if len(args) > 0 && (args[0] == "-h" || args[0] == "--help") {
			return cmd.Help()
		}
		return doShellCommand(cmd, args)
	},
}

func init() {
	rootCmd.AddCommand(shellCmd)
}

func doShellCommand(cmd *cobra.Command, args []string) error {
	cmd.SilenceUsage = true
	var commandName string
	if runtime.GOOS == "windows" {
		commandName = "wsl"
		distroName := "rancher-desktop"
		if !checkWSLIsRunning(distroName) {
			// No further output wanted, so just exit with the desired status.
			os.Exit(1)
		}
		args = append([]string{
			"--distribution", distroName,
			"--exec", "/usr/local/bin/wsl-exec"},
			args...)
	} else {
		if err := directories.SetupLimaHome(); err != nil {
			return err
		}
		execPath, err := os.Executable()
		if err != nil {
			return err
		}
		execPath, err = filepath.EvalSymlinks(execPath)
		if err != nil {
			return err
		}
		commandName = path.Join(path.Dir(path.Dir(execPath)), "lima", "bin", "limactl")
		if !checkLimaIsRunning(commandName) {
			// No further output wanted, so just exit with the desired status.
			os.Exit(1)
		}
		args = append([]string{"shell", "0"}, args...)
	}
	shellCommand := exec.Command(commandName, args...)
	shellCommand.Stdin = os.Stdin
	shellCommand.Stdout = os.Stdout
	shellCommand.Stderr = os.Stderr
	return shellCommand.Run()
}

const restartDirective = "Either run 'rdctl start' or start the Rancher Desktop application first"

func checkLimaIsRunning(commandName string) bool {
	var stdout bytes.Buffer
	var stderr bytes.Buffer

	cmd := exec.Command(commandName, "ls", "0", "--format", "{{.Status}}")
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
	if strings.Contains(errorMsg, "No instance matching 0 found.") {
		logrus.Errorf("The Rancher Desktop VM needs to be created.\n%s.\n", restartDirective)
	} else if len(errorMsg) > 0 {
		fmt.Fprintln(os.Stderr, errorMsg)
	} else {
		fmt.Fprintln(os.Stderr, "Underlying limactl check failed with no output.")
	}
	return false
}

func checkWSLIsRunning(distroName string) bool {
	// Ignore error messages; none are expected here
	rawOutput, err := exec.Command("wsl", "--list", "--verbose").CombinedOutput()
	if err != nil {
		logrus.Errorf("Failed to run 'wsl --list --verbose': %s\n", err)
		return false
	}
	decoder := unicode.UTF16(unicode.LittleEndian, unicode.IgnoreBOM).NewDecoder()
	output, err := decoder.Bytes(rawOutput)
	if err != nil {
		logrus.Errorf("Failed to read WSL output ([% q]...); error: %s\n", rawOutput[:12], err)
		return false
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
	if targetState == "Running" {
		return true
	}
	if !isListed {
		fmt.Fprintf(os.Stderr,
			"The Rancher Desktop WSL needs to be running in order to execute 'rdctl shell', but it currently is not.\n%s.\n", restartDirective)
		return false
	}
	fmt.Fprintf(os.Stderr,
		"The Rancher Desktop WSL needs to be in state \"Running\" in order to execute 'rdctl shell', but it is currently in state \"%s\".\n%s.\n", targetState, restartDirective)
	return false
}
