package cmd

import (
	"fmt"
	"os/exec"
	"runtime"

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

	// exclude snapshots directory from time machine backups if on macOS
	if runtime.GOOS == "darwin" {
		cmd := exec.Command("tmutil", "addexclusion", paths.Snapshots)
		if err := cmd.Run(); err != nil {
			return fmt.Errorf("failed to add exclusion to TimeMachine: %w", err)
		}
	}

	return nil
}
