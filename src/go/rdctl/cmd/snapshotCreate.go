package cmd

import (
	"context"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"os/signal"
	"runtime"
	"syscall"

	"github.com/sirupsen/logrus"
	"github.com/spf13/cobra"

	"github.com/rancher-sandbox/rancher-desktop/src/go/rdctl/pkg/runner"
	"github.com/rancher-sandbox/rancher-desktop/src/go/rdctl/pkg/snapshot"
)

var snapshotDescription string
var snapshotDescriptionFrom string

var snapshotCreateCmd = &cobra.Command{
	Use:   "create <name>",
	Short: "Create a snapshot",
	Args:  cobra.ExactArgs(1),
	RunE: func(cmd *cobra.Command, args []string) error {
		if snapshotDescription != "" && snapshotDescriptionFrom != "" {
			return fmt.Errorf(`can't specify more than one option from "--description" and "--description-from"`)
		}
		cmd.SilenceUsage = true
		if snapshotDescriptionFrom != "" {
			var bytes []byte
			var err error
			if snapshotDescriptionFrom == "-" {
				bytes, err = io.ReadAll(os.Stdin)
			} else {
				bytes, err = os.ReadFile(snapshotDescriptionFrom)
			}
			if err != nil {
				return err
			}
			snapshotDescription = string(bytes)
		}
		return exitWithJSONOrErrorCondition(createSnapshot(args))
	},
}

func init() {
	snapshotCmd.AddCommand(snapshotCreateCmd)
	snapshotCreateCmd.Flags().BoolVar(&outputJSONFormat, "json", false, "output json format")
	snapshotCreateCmd.Flags().StringVar(&snapshotDescription, "description", "", "snapshot description")
	snapshotCreateCmd.Flags().StringVar(&snapshotDescriptionFrom, "description-from", "", "snapshot description from a file (or - for stdin)")
}

func createSnapshot(args []string) error {
	name := args[0]
	manager, err := snapshot.NewManager()
	if err != nil {
		return fmt.Errorf("failed to create snapshot manager: %w", err)
	}
	// Report on invalid names before locking and shutting down the backend
	if err := manager.ValidateName(name); err != nil {
		return err
	}

	// Ideally we would not use the deprecated syscall package,
	// but it works well with all expected scenarios and allows us
	// to avoid platform-specific signal handling code.
	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGHUP, syscall.SIGTERM)
	defer stop()
	stopAfterFunc := context.AfterFunc(ctx, func() {
		if !outputJSONFormat {
			fmt.Println("Cancelling snapshot creation...")
		}
	})
	defer stopAfterFunc()
	_, err = manager.Create(ctx, name, snapshotDescription)
	if err != nil && !errors.Is(err, runner.ErrContextDone) {
		return fmt.Errorf("failed to create snapshot: %w", err)
	}

	// exclude snapshots directory from time machine backups if on macOS
	if runtime.GOOS != "darwin" {
		return nil
	}
	//nolint:gosec // manager.Snapshots is not a user input
	execCmd := exec.Command("tmutil", "addexclusion", manager.Snapshots)
	output, err := execCmd.CombinedOutput()
	if err != nil {
		msg := fmt.Errorf("`tmutil addexclusion` failed to add exclusion to TimeMachine: %w: %s", err, output)
		if outputJSONFormat {
			return msg
		} else {
			logrus.Errorln(msg)
		}
	}
	return nil
}
