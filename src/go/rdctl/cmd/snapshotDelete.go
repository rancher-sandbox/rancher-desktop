package cmd

import (
	"fmt"

	"github.com/spf13/cobra"

	"github.com/rancher-sandbox/rancher-desktop/src/go/rdctl/pkg/snapshot"
)

var snapshotDeleteCmd = &cobra.Command{
	Use:   "delete <id>",
	Short: "Delete a snapshot",
	Args:  cobra.ExactArgs(1),
	RunE: func(cmd *cobra.Command, args []string) error {
		cmd.SilenceUsage = true
		err := deleteSnapshot(cmd, args)
		return exitWithJSONOrErrorCondition(err)
	},
}

func init() {
	snapshotCmd.AddCommand(snapshotDeleteCmd)
	snapshotDeleteCmd.Flags().BoolVarP(&outputJSONFormat, "json", "", false, "output json format")
}

func deleteSnapshot(_ *cobra.Command, args []string) error {
	manager, err := snapshot.NewManager()
	if err != nil {
		return fmt.Errorf("failed to create snapshot manager: %w", err)
	}
	if err = manager.Delete(args[0]); err != nil {
		return fmt.Errorf("failed to delete snapshot %q: %w", args[0], err)
	}
	return nil
}
