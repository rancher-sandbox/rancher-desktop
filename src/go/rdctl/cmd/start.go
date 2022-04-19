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
	"os"
	"os/exec"
	"path"
	"runtime"
	"strconv"

	"github.com/spf13/cobra"
)

// startCmd represents the start command
var startCmd = &cobra.Command{
	Use:   "start",
	Short: "Start up Rancher Desktop, or update its settings.",
	Long: `Starts up Rancher Desktop with the specified settings.
If it's running, behaves the same as 'rdctl set ...'.
`,
	RunE: func(cmd *cobra.Command, args []string) error {
		if len(args) > 0 {
			return fmt.Errorf("start command: unrecognized command-line arguments specified: %v", args)
		}
		return doStartOrSetCommand(cmd)
	},
}

var applicationPath string

func init() {
	rootCmd.AddCommand(startCmd)
	updateCommonStartAndSetCommands(startCmd)
	startCmd.Flags().StringVarP(&applicationPath, "path", "p", "", "Path to main executable.")
}

// Unavoidable race condition here.
// There's no system-wide mutex that will let us guarantee that if rancher desktop is running when
// we test it (easiest to just try to get the settings), that it will still be running when we
// try to upload the settings (if any were specified).
func doStartOrSetCommand(cmd *cobra.Command) error {
	_, err := getListSettings()
	if err == nil {
		if applicationPath != "" {
			// `--path | -p` is not a valid option for `rdctl set...`
			return fmt.Errorf("--path specified but Rancher Desktop is already running", applicationPath)
		}
		return doSetCommand(cmd)
	}
	return doStartCommand(cmd)
}

func doStartCommand(cmd *cobra.Command) error {
	var commandLineArgs []string

	if cmd.Flags().Changed("container-engine") {
		commandLineArgs = append(commandLineArgs, "--kubernetes-container-engine", specifiedSettings.ContainerEngine)
	}
	if cmd.Flags().Changed("kubernetes-enabled") {
		commandLineArgs = append(commandLineArgs, "--kubernetes-enabled", strconv.FormatBool(specifiedSettings.Enabled))
	}
	if cmd.Flags().Changed("kubernetes-version") {
		commandLineArgs = append(commandLineArgs, "--kubernetes-version", specifiedSettings.Version)
	}
	if cmd.Flags().Changed("flannel-enabled") {
		commandLineArgs = append(commandLineArgs, "--kubernetes-options-flannel", strconv.FormatBool(specifiedSettings.Flannel))
	}
	if applicationPath == "" {
		pathLookupFuncs := map[string]func() string{
			"windows": getWindowsRDPath,
			"linux":   getLinuxRDPath,
			"darwin":  getMacOSRDPath,
		}
		getPathFunc, ok := pathLookupFuncs[runtime.GOOS]
		if !ok {
			return fmt.Errorf("don't know how to find the path to Rancher Desktop on OS %s", runtime.GOOS)
		}
		applicationPath = getPathFunc()
		if applicationPath == "" {
			return fmt.Errorf("no executable found in the default location; please retry with the --path|-p option")
		}
	}
	return launchApp(applicationPath, commandLineArgs)
}

func launchApp(applicationPath string, commandLineArgs []string) error {
	var commandName string
	var args []string

	if runtime.GOOS == "darwin" {
		commandName = "open"
		args = append(args, "-a", applicationPath)
		if len(commandLineArgs) > 0 {
			args = append(args, "--args")
			args = append(args, commandLineArgs...)
		}
	} else {
		commandName = applicationPath
		args = commandLineArgs
	}
	cmd := exec.Command(commandName, args...)
	cmd.Stdout = os.Stdout
	cmd.Stderr = os.Stderr
	return cmd.Run()
}

func getWindowsRDPath() string {
	appData := os.Getenv("APPDATA")
	if appData == "" {
		var homeDir string
		homeDrive := os.Getenv("HOMEDRIVE")
		homePath := os.Getenv("HOMEPATH")
		if homeDrive != "" && homePath != "" {
			homeDir = homeDrive + homePath
		} else {
			homeDir = os.Getenv("HOME")
		}
		if homeDir == "" {
			return ""
		}
		appData = path.Join(homeDir, "Local", "Programs", "Rancher Desktop")
	}
	return checkExistence(path.Join(appData, "Rancher Desktop.exe"))
}

func getMacOSRDPath() string {
	return checkExistence(path.Join("/Applications", "Rancher Desktop.app"))
}

func getLinuxRDPath() string {
	candidatePath := "/opt/rancher-desktop/rancher-desktop"
	stat, err := os.Stat(candidatePath)
	if err == nil && (stat.Mode().Perm()&0111) != 0 {
		return candidatePath
	}
	candidatePath, err = exec.LookPath("rancher-desktop")
	if err != nil {
		return ""
	}
	if candidatePath[0] == '/' {
		return candidatePath
	}
	var pwd string
	pwd, err = os.Getwd()
	if err != nil {
		// If getwd fails don't bother trying to continue.
		return ""
	}
	return path.Join(pwd, candidatePath)
}

func checkExistence(candidatePath string) string {
	_, err := os.Stat(candidatePath)
	if err != nil {
		return ""
	}
	return candidatePath
}
