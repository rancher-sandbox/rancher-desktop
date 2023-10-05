package cmd

import (
	"fmt"

	"github.com/rancher-sandbox/rancher-desktop/src/go/rdctl/pkg/paths"
	"github.com/rancher-sandbox/rancher-desktop/src/go/rdctl/pkg/snapshot"
	"github.com/spf13/cobra"
)

var snapshotDeleteCmd = &cobra.Command{
	Use:   "delete <id>",
	Short: "Delete a snapshot",
	Args:  cobra.ExactArgs(1),
	RunE: func(cmd *cobra.Command, args []string) error {
		err := deleteSnapshot(cmd, args)
		return exitWithJsonOrErrorCondition(err)
	},
}

func init() {
	snapshotCmd.AddCommand(snapshotDeleteCmd)
	snapshotDeleteCmd.Flags().BoolVarP(&outputJsonFormat, "json", "", false, "output json format")
}

func deleteSnapshot(cmd *cobra.Command, args []string) error {
	cmd.SilenceUsage = true
	appPaths, err := paths.GetPaths()
	if err != nil {
		return fmt.Errorf("failed to get paths: %w", err)
	}
	manager := snapshot.NewManager(appPaths)
	id, err := getSnapshotId(manager, args[0])
	if err != nil {
		return fmt.Errorf("can't delete snapshot: %w", err)
	}
	if err = manager.Delete(id); err != nil {
		return fmt.Errorf("failed to delete snapshot: %w", err)
	}
	return nil
}
