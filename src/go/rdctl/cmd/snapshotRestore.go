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
	RunE:  stopBackendCallFuncAndRestartBackend(restoreSnapshot),
}

func init() {
	snapshotCmd.AddCommand(snapshotRestoreCmd)
}

func restoreSnapshot(cmd *cobra.Command, args []string) error {
	paths, err := paths.GetPaths()
	if err != nil {
		return fmt.Errorf("failed to get paths: %w", err)
	}
	manager := snapshot.NewManager(paths)
	if err := manager.Restore(args[0]); err != nil {
		return fmt.Errorf("failed to restore snapshot %q: %w", args[0], err)
	}
	return nil
}
