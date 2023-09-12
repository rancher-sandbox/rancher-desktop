package cmd

import (
	"fmt"

	"github.com/rancher-sandbox/rancher-desktop/src/go/rdctl/pkg/paths"
	"github.com/rancher-sandbox/rancher-desktop/src/go/rdctl/pkg/snapshot"
	"github.com/spf13/cobra"
)

var snapshotCreateCmd = &cobra.Command{
	Use:   "create <name>",
	Short: "Create a snapshot",
	Args:  cobra.ExactArgs(1),
	RunE: func(cmd *cobra.Command, args []string) error {
		return snapshotCreate(cmd, args)
	},
}

func init() {
	snapshotCmd.AddCommand(snapshotCreateCmd)
}

func snapshotCreate(cmd *cobra.Command, args []string) error {
	paths, err := paths.GetPaths()
	if err != nil {
		return fmt.Errorf("failed to get paths: %w", err)
	}
	manager := snapshot.NewManager(paths)
	if _, err := manager.Create(args[0]); err != nil {
		return fmt.Errorf("failed to create snapshot: %w", err)
	}
	return nil
}
