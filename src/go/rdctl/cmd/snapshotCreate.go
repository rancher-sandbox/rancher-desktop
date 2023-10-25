package cmd

import (
	"fmt"
	"github.com/rancher-sandbox/rancher-desktop/src/go/rdctl/pkg/paths"
	"github.com/rancher-sandbox/rancher-desktop/src/go/rdctl/pkg/snapshot"
	"github.com/sirupsen/logrus"
	"github.com/spf13/cobra"
	"os/exec"
	"runtime"
)

var snapshotDescription string

var snapshotCreateCmd = &cobra.Command{
	Use:   "create <name>",
	Short: "Create a snapshot",
	Args:  cobra.ExactArgs(1),
	RunE: func(cmd *cobra.Command, args []string) error {
		cmd.SilenceUsage = true
		return exitWithJsonOrErrorCondition(createSnapshot(cmd, args))
	},
}

func init() {
	snapshotCmd.AddCommand(snapshotCreateCmd)
	snapshotCreateCmd.Flags().BoolVar(&outputJsonFormat, "json", false, "output json format")
	snapshotCreateCmd.Flags().StringVar(&snapshotDescription, "description", "", "snapshot description")
}

func createSnapshot(cmd *cobra.Command, args []string) error {
	appPaths, err := paths.GetPaths()
	if err != nil {
		return fmt.Errorf("failed to get paths: %w", err)
	}
	manager := snapshot.NewManager(appPaths)
	if err := manager.ValidateName(args[0]); err != nil {
		return err
	}
	err = wrapSnapshotOperation(cmd, appPaths, true, func() error {
		if _, err := manager.Create(args[0], snapshotDescription); err != nil {
			return fmt.Errorf("failed to create snapshot: %w", err)
		}
		return nil
	})
	if err != nil {
		return err
	}
	if runtime.GOOS != "darwin" {
		return nil
	}

	// exclude snapshots directory from time machine backups if on macOS
	execCmd := exec.Command("tmutil", "addexclusion", appPaths.Snapshots)
	output, err := execCmd.CombinedOutput()
	if err != nil {
		msg := fmt.Errorf("`tmutil addexclusion` failed to add exclusion to TimeMachine: %w: %s", err, output)
		if outputJsonFormat {
			snapshotErrors = append(snapshotErrors, msg)
		} else {
			logrus.Errorln(msg)
		}
	}
	return nil
}
