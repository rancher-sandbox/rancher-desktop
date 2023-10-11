package cmd

import (
	"fmt"

	"github.com/spf13/cobra"
)

var snapshotRestoreCmd = &cobra.Command{
	Use:   "restore <id>",
	Short: "Restore a snapshot",
	Args:  cobra.ExactArgs(1),
	RunE: func(cmd *cobra.Command, args []string) error {
		cmd.SilenceUsage = true
		return exitWithJsonOrErrorCondition(restoreSnapshot(cmd, args))
	},
}

func init() {
	snapshotCmd.AddCommand(snapshotRestoreCmd)
	snapshotRestoreCmd.Flags().BoolVarP(&outputJsonFormat, "json", "", false, "output json format")
}

func restoreSnapshot(cmd *cobra.Command, args []string) error {
	manager, id, err := getSnapshotIdAndManager(args)
	if err != nil {
		return err
	}
	return wrapSnapshotOperation(func(_ *cobra.Command) error {
		if err := manager.Restore(id); err != nil {
			return fmt.Errorf("failed to restore snapshot %q: %w", args[0], err)
		}
		return nil
	})(cmd)
}
