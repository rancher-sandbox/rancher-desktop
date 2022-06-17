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
	"io/fs"
	"os"
	"os/exec"
	"path"
	"runtime"
	"strconv"
	"strings"

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
		err := cobra.NoArgs(cmd, args)
		if err != nil {
			return err
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

/**
 * If Rancher Desktop is currently running, treat this like a `set` command, and pass all the args to that.
 */
func doStartOrSetCommand(cmd *cobra.Command) error {
	_, err := getListSettings()
	if err == nil {
		// Unavoidable race condition here.
		// There's no system-wide mutex that will let us guarantee that if rancher desktop is running when
		// we test it (easiest to just try to get the settings), that it will still be running when we
		// try to upload the settings (if any were specified).
		if applicationPath != "" {
			// `--path | -p` is not a valid option for `rdctl set...`
			return fmt.Errorf("--path %s specified but Rancher Desktop is already running", applicationPath)
		}
		err = doSetCommand(cmd)
		if err == nil || cmd.Name() == "set" {
			return err
		}
	}
	// If `set...` failed, try running the original `start` command, if only to give
	// an error message from the point of view of `start` rather than `set`.
	cmd.SilenceUsage = true
	return doStartCommand(cmd)
}

func doStartCommand(cmd *cobra.Command) error {
	var commandLineArgs []string

	if cmd.Flags().Changed("container-engine") {
		commandLineArgs = append(commandLineArgs, "--kubernetes-containerEngine", specifiedSettings.ContainerEngine)
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
		pathLookupFuncs := map[string]func(rdctlPath string) string{
			"windows": getWindowsRDPath,
			"linux":   getLinuxRDPath,
			"darwin":  getMacOSRDPath,
		}
		getPathFunc, ok := pathLookupFuncs[runtime.GOOS]
		if !ok {
			return fmt.Errorf("don't know how to find the path to Rancher Desktop on OS %s", runtime.GOOS)
		}
		rdctlPath, err := os.Executable()
		if err != nil {
			rdctlPath = ""
		}
		applicationPath = getPathFunc(rdctlPath)
		if applicationPath == "" {
			return fmt.Errorf("could not locate main Rancher Desktop executable; please retry with the --path option")
		}
	}
	return launchApp(applicationPath, commandLineArgs)
}

func launchApp(applicationPath string, commandLineArgs []string) error {
	var commandName string
	var args []string

	if runtime.GOOS == "darwin" {
		commandName = "/usr/bin/open"
		args = []string{"-a", applicationPath}
		if len(commandLineArgs) > 0 {
			args = append(args, "--args")
			args = append(args, commandLineArgs...)
		}
	} else {
		commandName = applicationPath
		args = commandLineArgs
	}
	// Include this output because there's a delay before the UI comes up.
	// Without this line, it might look like the command doesn't work.
	fmt.Fprintf(os.Stderr, "About to launch %s %s ...\n", commandName, strings.Join(args, " "))
	cmd := exec.Command(commandName, args...)
	cmd.Stdout = os.Stdout
	cmd.Stderr = os.Stderr
	return cmd.Start()
}

func moveToParent(fullPath string, numberTimes int) string {
	fullPath = path.Clean(fullPath)
	for ; numberTimes > 0; numberTimes-- {
		fullPath = path.Dir(fullPath)
	}
	return fullPath
}

func getWindowsRDPath(rdctlPath string) string {
	if rdctlPath != "" {
		normalParentPath := moveToParent(rdctlPath, 5)
		candidatePath := checkExistence(path.Join(normalParentPath, "Rancher Desktop.exe"), 0)
		if candidatePath != "" {
			return candidatePath
		}
	}
	localAppDataGetters := []func() string{
		func() string {
			return os.Getenv("LOCALAPPDATA")
		},
		func() string {
			homePath, err := os.UserHomeDir()
			if err != nil || homePath == "" {
				return ""
			}
			return path.Join(homePath, "AppData", "Local")
		},
		func() string {
			homeDrive := os.Getenv("HOMEDRIVE")
			if homeDrive == "" {
				return ""
			}
			homePathPart := os.Getenv("HOMEPATH")
			if homePathPart == "" {
				return ""
			}
			return path.Join(homeDrive+homePathPart, "AppData", "Local")
		},
		func() string {
			homePath := os.Getenv("HOME")
			if homePath == "" {
				return ""
			}
			return path.Join(homePath, "AppData", "Local")
		},
	}
	for _, localAppDataGetter := range localAppDataGetters {
		localAppDataDir := localAppDataGetter()
		candidatePath := checkExistence(path.Join(localAppDataDir, "Programs", "Rancher Desktop", "Rancher Desktop.exe"), 0)
		if candidatePath != "" {
			return candidatePath
		}
	}
	return ""
}

func getMacOSRDPath(rdctlPath string) string {
	if rdctlPath != "" {
		// we're at .../Applications/R D.app (could have a different name)/Contents/Resources/resources/darwin/bin
		// and want to move to the "R D.app" part
		RDAppParentPath := moveToParent(rdctlPath, 6)
		if checkExistence(path.Join(RDAppParentPath, "Contents", "MacOS", "Rancher Desktop"), 0o111) != "" {
			return RDAppParentPath
		}
	}
	// This fallback is mostly for running `npm run dev` and using the installed app because there is no app
	// that rdctl would launch directly in dev mode.
	return checkExistence(path.Join("/Applications", "Rancher Desktop.app"), 0)
}

func getLinuxRDPath(rdctlPath string) string {
	if rdctlPath != "" {
		normalParentPath := moveToParent(rdctlPath, 5)
		candidatePath := checkExistence(path.Join(normalParentPath, "rancher-desktop"), 0o111)
		if candidatePath != "" {
			return candidatePath
		}
	}
	return checkExistence("/opt/rancher-desktop/rancher-desktop", 0o111)
}

/**
 * Verify the path exists. For Linux pass in mode bits to guarantee the file is executable (for at least one
 * category of user). Note that on macOS the candidate is a directory, so never pass in mode bits.
 * And mode bits don't make sense on Windows.
 */
func checkExistence(candidatePath string, modeBits fs.FileMode) string {
	stat, err := os.Stat(candidatePath)
	if err != nil {
		return ""
	}
	if modeBits != 0 && (!stat.Mode().IsRegular() || stat.Mode().Perm()&modeBits == 0) {
		// The modeBits check is only for executability -- we only care if at least one of the three
		// `x` mode bits is on. So this check isn't used for a general permission-mode-bit check.
		return ""
	}
	return candidatePath
}
