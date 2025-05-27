package cmd

import (
	"context"
	"errors"
	"fmt"
	"os/signal"
	"syscall"

	"github.com/spf13/cobra"

	"github.com/rancher-sandbox/rancher-desktop/src/go/rdctl/pkg/runner"
	"github.com/rancher-sandbox/rancher-desktop/src/go/rdctl/pkg/snapshot"
)

var snapshotRestoreCmd = &cobra.Command{
	Use:   "restore <id>",
	Short: "Restore a snapshot",
	Args:  cobra.ExactArgs(1),
	RunE: func(cmd *cobra.Command, args []string) error {
		cmd.SilenceUsage = true
		return exitWithJSONOrErrorCondition(restoreSnapshot(args[0]))
	},
}

func init() {
	snapshotCmd.AddCommand(snapshotRestoreCmd)
	snapshotRestoreCmd.Flags().BoolVarP(&outputJSONFormat, "json", "", false, "output json format")
}

func restoreSnapshot(name string) error {
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
		if !outputJSONFormat {
			fmt.Println("Cancelling snapshot restoration...")
		}
	})
	defer stopAfterFunc()
	err = manager.Restore(ctx, name)
	if err != nil && !errors.Is(err, runner.ErrContextDone) {
		return fmt.Errorf("failed to restore snapshot %q: %w", name, err)
	}
	return nil
}
