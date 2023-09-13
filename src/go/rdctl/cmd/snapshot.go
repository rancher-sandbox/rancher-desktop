package cmd

import (
	"fmt"
	"os/exec"
	"runtime"

	"github.com/rancher-sandbox/rancher-desktop/src/go/rdctl/pkg/paths"
	"github.com/spf13/cobra"
)

var snapshotCmd = &cobra.Command{
	Use:    "snapshot",
	Short:  "Manage Rancher Desktop snapshots",
	Hidden: true,
	PersistentPreRunE: func(cmd *cobra.Command, args []string) error {
		paths, err := paths.GetPaths()
		if err != nil {
			return fmt.Errorf("failed to get paths: %w", err)
		}
		// exclude snapshots directory from time machine backups if on macOS
		if runtime.GOOS == "darwin" {
			cmd := exec.Command("tmutil", "addexclusion", paths.Snapshots)
			if err := cmd.Run(); err != nil {
				return fmt.Errorf("failed to add exclusion to TimeMachine: %w", err)
			}
		}
		return nil
	},
}

func init() {
	rootCmd.AddCommand(snapshotCmd)
}
