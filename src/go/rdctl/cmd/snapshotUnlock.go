package cmd

import (
	"fmt"
	p "github.com/rancher-sandbox/rancher-desktop/src/go/rdctl/pkg/paths"
	"github.com/spf13/cobra"
)

var snapshotUnlockCmd = &cobra.Command{
	Use:   "unlock",
	Short: "Remove snapshot lock",
	Long: `If an error occurs while doing a snapshot operation, sometimes the
filesystem lock used to prevent simultaneous snapshot operations
can be left behind. It then becomes impossible to work with
snapshots. This command removes the filesystem lock. You should
not have to use it under normal circumstances.`,
	Args: cobra.NoArgs,
	RunE: func(cmd *cobra.Command, args []string) error {
		paths, err := p.GetPaths()
		if err != nil {
			return fmt.Errorf("failed to get paths: %w", err)
		}
		return removeBackendLock(paths.AppHome)
	},
}

func init() {
	snapshotCmd.AddCommand(snapshotUnlockCmd)
}
