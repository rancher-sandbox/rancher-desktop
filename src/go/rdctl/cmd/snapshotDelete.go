package cmd

import (
	"fmt"

	p "github.com/rancher-sandbox/rancher-desktop/src/go/rdctl/pkg/paths"
	"github.com/rancher-sandbox/rancher-desktop/src/go/rdctl/pkg/snapshot"
	"github.com/spf13/cobra"
)

var snapshotDeleteCmd = &cobra.Command{
	Use:   "delete <id>",
	Short: "Delete a snapshot",
	Args:  cobra.ExactArgs(1),
	RunE: func(cmd *cobra.Command, args []string) error {
		paths, err := p.GetPaths()
		if err != nil {
			return fmt.Errorf("failed to get paths: %w", err)
		}
		manager := snapshot.NewManager(paths)
		if err = manager.Delete(args[0]); err != nil {
			return fmt.Errorf("failed to delete snapshot: %w", err)
		}
		return nil
	},
}

func init() {
	snapshotCmd.AddCommand(snapshotDeleteCmd)
}
