package cmd

import (
	"fmt"
	"github.com/rancher-sandbox/rancher-desktop/src/go/rdctl/pkg/paths"
	"github.com/spf13/cobra"
)

var snapshotCleanCmd = &cobra.Command{
	Use:   "clean",
	Short: "Clean snapshot state",
	RunE: func(cmd *cobra.Command, args []string) error {
		paths, err := paths.GetPaths()
		if err != nil {
			return fmt.Errorf("failed to get paths: %w", err)
		}
		return removeSnapshotLock(paths)
	},
}

func init() {
	snapshotCmd.AddCommand(snapshotCleanCmd)
}
