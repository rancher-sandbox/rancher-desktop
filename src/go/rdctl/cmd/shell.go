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
	"fmt"
	"github.com/spf13/cobra"
	"os"
	"os/exec"
	"path"
	"path/filepath"
	"runtime"
	"strings"
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
		args = append([]string{"-d", "rancher-desktop"}, args...)
	} else {
		err := setupLimaHome()
		if err != nil {
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

func setupLimaHome() error {
	var candidatePath string
	if runtime.GOOS == "linux" {
		candidatePath = path.Join(os.Getenv("HOME"), ".local", "share", "rancher-desktop", "lima")
	} else {
		candidatePath = path.Join(os.Getenv("HOME"), "Library", "Application Support", "rancher-desktop", "lima")
	}
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

func checkLimaIsRunning(commandName string) bool {
	const howToStartMessage = "Either run `rdctl start` or start the Rancher Desktop application."
	output, err := exec.Command(commandName, "ls", "0", "--format", "{{.Status}}").CombinedOutput()
	if err == nil {
		if strings.HasPrefix(string(output), "Running") {
			return true
		} else {
			fmt.Fprintf(os.Stderr, fmt.Sprintf(
				`The Rancher Desktop VM status is currently "%s",
but needs to be "Running" to shell into it.
%s
`, strings.TrimRight(string(output), "\n"), howToStartMessage))
			return false
		}
	}
	fmt.Fprintf(os.Stderr, fmt.Sprintf(`Rancher Desktop needs to be running in order to shell into it.
%s
`, howToStartMessage))
	return false
}
