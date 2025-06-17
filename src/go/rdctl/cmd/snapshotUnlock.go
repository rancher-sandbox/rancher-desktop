package cmd

import (
	"context"
	"fmt"

	"github.com/spf13/cobra"

	"github.com/rancher-sandbox/rancher-desktop/src/go/rdctl/pkg/snapshot"
)

var snapshotUnlockCmd = &cobra.Command{
	Use:   "unlock",
	Short: "Remove snapshot lock",
	Long: `If an error occurs while doing a snapshot operation, the filesystem
lock that is used to prevent simultaneous snapshot operations can be
left behind. It then becomes impossible to run any snapshot operations.
This command removes the filesystem lock. It should not be needed under
normal circumstances.`,
	Args: cobra.NoArgs,
	RunE: func(cmd *cobra.Command, args []string) error {
		cmd.SilenceUsage = true
		return exitWithJSONOrErrorCondition(unlockSnapshot(cmd.Context()))
	},
}

func init() {
	snapshotCmd.AddCommand(snapshotUnlockCmd)
	snapshotUnlockCmd.Flags().BoolVarP(&outputJSONFormat, "json", "", false, "output json format")
}

func unlockSnapshot(ctx context.Context) error {
	manager, err := snapshot.NewManager()
	if err != nil {
		return fmt.Errorf("failed to create snapshot manager: %w", err)
	}
	return manager.Unlock(ctx, manager.Paths, false)
}
