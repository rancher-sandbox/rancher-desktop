package cmd

import (
	"fmt"

	"github.com/rancher-sandbox/rancher-desktop/src/go/rdctl/pkg/paths"
	"github.com/rancher-sandbox/rancher-desktop/src/go/rdctl/pkg/snapshot"
	"github.com/spf13/cobra"
)

var snapshotRestoreCmd = &cobra.Command{
	Use:   "restore <id>",
	Short: "Restore a snapshot",
	Args:  cobra.ExactArgs(1),
	RunE: func(cmd *cobra.Command, args []string) error {
		cmd.SilenceUsage = true
		err := wrapSnapshotOperation(restoreSnapshot)(cmd, args)
		return exitWithJsonOrErrorCondition(err)
	},
}

func init() {
	snapshotCmd.AddCommand(snapshotRestoreCmd)
	snapshotRestoreCmd.Flags().BoolVarP(&outputJsonFormat, "json", "", false, "output json format")

}

func restoreSnapshot(_ *cobra.Command, args []string) error {
	appPaths, err := paths.GetPaths()
	if err != nil {
		return fmt.Errorf("failed to get paths: %w", err)
	}
	manager := snapshot.NewManager(appPaths)
	id, err := getSnapshotId(manager, args[0])
	if err != nil {
		return fmt.Errorf("can't restore snapshot: %w", err)
	}
	if err := manager.Restore(id); err != nil {
		return fmt.Errorf("failed to restore snapshot %q: %w", args[0], err)
	}
	return nil
}
