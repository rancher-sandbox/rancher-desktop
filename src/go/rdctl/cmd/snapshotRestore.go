package cmd

import (
	"context"
	"errors"
	"fmt"
	"os/signal"
	"syscall"

	"github.com/rancher-sandbox/rancher-desktop/src/go/rdctl/pkg/runner"
	"github.com/rancher-sandbox/rancher-desktop/src/go/rdctl/pkg/snapshot"
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
	manager, err := snapshot.NewManager()
	if err != nil {
		return fmt.Errorf("failed to create snapshot manager: %w", err)
	}

	// Ideally we would not use the deprecated syscall package,
	// but it works well with all expected scenarios and allows us
	// to avoid platform-specific signal handling code.
	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGHUP, syscall.SIGTERM)
	defer stop()
	stopAfterFunc := context.AfterFunc(ctx, func() {
		if !outputJsonFormat {
			fmt.Println("Cancelling snapshot restoration...")
		}
	})
	defer stopAfterFunc()
	err = manager.Restore(ctx, args[0])
	if err != nil && !errors.Is(err, runner.ErrContextDone) {
		return fmt.Errorf("failed to restore snapshot %q: %w", args[0], err)
	}
	return nil
}
