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
	"context"
	"fmt"
	"os"
	"os/exec"
	"runtime"
	"strings"

	"github.com/sirupsen/logrus"
	"github.com/spf13/cobra"

	options "github.com/rancher-sandbox/rancher-desktop/src/go/rdctl/pkg/options/generated"
	"github.com/rancher-sandbox/rancher-desktop/src/go/rdctl/pkg/paths"
)

// startCmd represents the start command
var startCmd = &cobra.Command{
	Use:   "start",
	Short: "Start up Rancher Desktop, or update its settings.",
	Long: `Starts up Rancher Desktop with the specified settings.
If it's running, behaves the same as 'rdctl set ...'.
`,
	RunE: func(cmd *cobra.Command, args []string) error {
		if err := cobra.NoArgs(cmd, args); err != nil {
			return err
		}
		return doStartOrSetCommand(cmd)
	},
}

var applicationPath string
var noModalDialogs bool

func init() {
	rootCmd.AddCommand(startCmd)
	options.UpdateCommonStartAndSetCommands(startCmd)
	startCmd.Flags().StringVarP(&applicationPath, "path", "p", "", "path to main executable")
	startCmd.Flags().BoolVarP(&noModalDialogs, "no-modal-dialogs", "", false, "avoid displaying dialog boxes")
}

/**
 * If Rancher Desktop is currently running, treat this like a `set` command, and pass all the args to that.
 */
func doStartOrSetCommand(cmd *cobra.Command) error {
	_, err := getListSettings(cmd.Context())
	if err == nil {
		// Unavoidable race condition here.
		// There's no system-wide mutex that will let us guarantee that if rancher desktop is running when
		// we test it (easiest to just try to get the settings), that it will still be running when we
		// try to upload the settings (if any were specified).
		if applicationPath != "" {
			// `--path | -p` is not a valid option for `rdctl set...`
			return fmt.Errorf("--path %q specified but Rancher Desktop is already running", applicationPath)
		}
		return doSetCommand(cmd)
	}
	cmd.SilenceUsage = true
	return doStartCommand(cmd)
}

func doStartCommand(cmd *cobra.Command) error {
	commandLineArgs, err := options.GetCommandLineArgsForStartCommand(cmd.Flags())
	if err != nil {
		return err
	}
	if !cmd.Flags().Changed("path") {
		applicationPath, err = paths.GetRDLaunchPath(cmd.Context())
		if err != nil {
			return fmt.Errorf("failed to locate main Rancher Desktop executable: %w\nplease retry with the --path option", err)
		}
	}
	if noModalDialogs {
		commandLineArgs = append(commandLineArgs, "--no-modal-dialogs")
	}
	return launchApp(cmd.Context(), applicationPath, commandLineArgs)
}

func launchApp(ctx context.Context, applicationPath string, commandLineArgs []string) error {
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
	logrus.Infof("About to launch %s %s ...\n", commandName, strings.Join(args, " "))
	cmd := exec.CommandContext(ctx, commandName, args...)
	cmd.Stdout = os.Stdout
	cmd.Stderr = os.Stderr
	return cmd.Start()
}
