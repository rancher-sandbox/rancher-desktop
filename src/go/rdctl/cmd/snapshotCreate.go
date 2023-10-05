package cmd

import (
	"fmt"
	"os/exec"
	"runtime"

	"github.com/rancher-sandbox/rancher-desktop/src/go/rdctl/pkg/paths"
	"github.com/rancher-sandbox/rancher-desktop/src/go/rdctl/pkg/snapshot"
	"github.com/spf13/cobra"
)

var snapshotCreateCmd = &cobra.Command{
	Use:   "create <name>",
	Short: "Create a snapshot",
	Args:  cobra.ExactArgs(1),
	RunE: func(cmd *cobra.Command, args []string) error {
		cmd.SilenceUsage = true
		err := wrapSnapshotOperation(createSnapshot)(cmd, args)
		return exitWithJsonOrErrorCondition(err)
	},
}

func init() {
	snapshotCmd.AddCommand(snapshotCreateCmd)
	snapshotCreateCmd.Flags().BoolVarP(&outputJsonFormat, "json", "", false, "output json format")
}

func createSnapshot(_ *cobra.Command, args []string) error {
	appPaths, err := paths.GetPaths()
	if err != nil {
		return fmt.Errorf("failed to get paths: %w", err)
	}
	manager := snapshot.NewManager(appPaths)
	if _, err := manager.Create(args[0]); err != nil {
		return fmt.Errorf("failed to create snapshot: %w", err)
	}
	// exclude snapshots directory from time machine backups if on macOS
	if runtime.GOOS == "darwin" {
		cmd := exec.Command("tmutil", "addexclusion", appPaths.Snapshots)
		if err := cmd.Run(); err != nil {
			return fmt.Errorf("failed to add exclusion to TimeMachine: %w", err)
		}
	}
	return nil
}
