package cmd

import (
	"fmt"

	"github.com/rancher-sandbox/rancher-desktop/src/go/rdctl/pkg/snapshot"
	"github.com/spf13/cobra"
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
		return exitWithJsonOrErrorCondition(unlockSnapshot())
	},
}

func init() {
	snapshotCmd.AddCommand(snapshotUnlockCmd)
	snapshotUnlockCmd.Flags().BoolVarP(&outputJsonFormat, "json", "", false, "output json format")
}

func unlockSnapshot() error {
	manager, err := snapshot.NewManager()
	if err != nil {
		return fmt.Errorf("failed to create snapshot manager: %w", err)
	}
	return manager.Unlock(manager.Paths, false)
}
