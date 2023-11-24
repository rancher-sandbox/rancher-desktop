package cmd

import (
	"context"
	"errors"
	"fmt"
	"os/exec"
	"os/signal"
	"runtime"
	"syscall"

	"github.com/rancher-sandbox/rancher-desktop/src/go/rdctl/pkg/runner"
	"github.com/rancher-sandbox/rancher-desktop/src/go/rdctl/pkg/snapshot"
	"github.com/sirupsen/logrus"
	"github.com/spf13/cobra"
)

var snapshotDescription string

var snapshotCreateCmd = &cobra.Command{
	Use:   "create <name>",
	Short: "Create a snapshot",
	Args:  cobra.ExactArgs(1),
	RunE: func(cmd *cobra.Command, args []string) error {
		cmd.SilenceUsage = true
		return exitWithJsonOrErrorCondition(createSnapshot(args))
	},
}

func init() {
	snapshotCmd.AddCommand(snapshotCreateCmd)
	snapshotCreateCmd.Flags().BoolVar(&outputJsonFormat, "json", false, "output json format")
	snapshotCreateCmd.Flags().StringVar(&snapshotDescription, "description", "", "snapshot description")
}

func createSnapshot(args []string) error {
	name := args[0]
	manager, err := snapshot.NewManager()
	if err != nil {
		return fmt.Errorf("failed to create snapshot manager: %w", err)
	}
	// Report on invalid names before locking and shutting down the backend
	if err := manager.ValidateName(name); err != nil {
		return nil
	}

	// Ideally we would not use the deprecated syscall package,
	// but it works well with all expected scenarios and allows us
	// to avoid platform-specific signal handling code.
	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGHUP, syscall.SIGTERM)
	defer stop()
	context.AfterFunc(ctx, func() {
		if !outputJsonFormat {
			fmt.Println("Cancelling snapshot creation...")
		}
	})
	_, err = manager.Create(ctx, name, snapshotDescription)
	if err != nil && !errors.Is(err, runner.ErrContextDone) {
		return fmt.Errorf("failed to create snapshot: %w", err)
	}

	// exclude snapshots directory from time machine backups if on macOS
	if runtime.GOOS != "darwin" {
		return nil
	}
	execCmd := exec.Command("tmutil", "addexclusion", manager.Paths.Snapshots)
	output, err := execCmd.CombinedOutput()
	if err != nil {
		msg := fmt.Errorf("`tmutil addexclusion` failed to add exclusion to TimeMachine: %w: %s", err, output)
		if outputJsonFormat {
			return msg
		} else {
			logrus.Errorln(msg)
		}
	}
	return nil
}
