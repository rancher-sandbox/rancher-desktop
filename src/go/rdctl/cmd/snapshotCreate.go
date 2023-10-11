package cmd

import (
	"fmt"
	"os/exec"
	"runtime"

	"github.com/rancher-sandbox/rancher-desktop/src/go/rdctl/pkg/paths"
	"github.com/rancher-sandbox/rancher-desktop/src/go/rdctl/pkg/snapshot"
	"github.com/spf13/cobra"
)

var snapshotDescription string

var snapshotCreateCmd = &cobra.Command{
	Use:   "create <name>",
	Short: "Create a snapshot",
	Args:  cobra.ExactArgs(1),
	RunE: func(cmd *cobra.Command, args []string) error {
		cmd.SilenceUsage = true
		return exitWithJsonOrErrorCondition(createSnapshot(cmd, args))
	},
}

func init() {
	snapshotCmd.AddCommand(snapshotCreateCmd)
	snapshotCreateCmd.Flags().BoolVar(&outputJsonFormat, "json", false, "output json format")
	snapshotCreateCmd.Flags().StringVar(&snapshotDescription, "description", "", "snapshot description")
}

func createSnapshot(cmd *cobra.Command, args []string) error {
	return wrapSnapshotOperation(func(_ *cobra.Command) error {
		appPaths, err := paths.GetPaths()
		if err != nil {
			return fmt.Errorf("failed to get paths: %w", err)
		}
		manager := snapshot.NewManager(appPaths)
		if _, err := manager.Create(args[0], snapshotDescription); err != nil {
			return fmt.Errorf("failed to create snapshot %q: %w", args[0], err)
		}
		// exclude snapshots directory from time machine backups if on macOS
		if runtime.GOOS == "darwin" {
			appPaths, err := paths.GetPaths()
			if err != nil {
				return fmt.Errorf("failed to get paths: %w", err)
			}
			cmd := exec.Command("tmutil", "addexclusion", appPaths.Snapshots)
			if err := cmd.Run(); err != nil {
				return fmt.Errorf("failed to add exclusion to TimeMachine: %w", err)
			}
		}
		return nil
	})(cmd)
}
