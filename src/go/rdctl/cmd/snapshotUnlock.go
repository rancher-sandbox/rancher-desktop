package cmd

import (
	"fmt"
	p "github.com/rancher-sandbox/rancher-desktop/src/go/rdctl/pkg/paths"
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
		err := unlockSnapshot()
		if err != nil {
			return exitWithJSONOrErrorCondition(err)
		}
		return nil
	},
}

func init() {
	snapshotCmd.AddCommand(snapshotUnlockCmd)
}

func unlockSnapshot() error {
	paths, err := p.GetPaths()
	if err != nil {
		return fmt.Errorf("failed to get paths: %w", err)
	}
	return removeBackendLock(paths.AppHome)
}
