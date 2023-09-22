package cmd

import (
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"syscall"
	"time"

	"github.com/rancher-sandbox/rancher-desktop/src/go/rdctl/pkg/client"
	"github.com/rancher-sandbox/rancher-desktop/src/go/rdctl/pkg/config"
	"github.com/rancher-sandbox/rancher-desktop/src/go/rdctl/pkg/paths"
	"github.com/spf13/cobra"
)

type cobraFunc func(cmd *cobra.Command, args []string) error

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

func stopBackendCallFuncAndRestartBackend(wrappedFunction cobraFunc) cobraFunc {
	return func(cmd *cobra.Command, args []string) error {
		paths, err := paths.GetPaths()
		if err != nil {
			return fmt.Errorf("failed to get paths: %w", err)
		}
		if err := createSnapshotLock(paths); err != nil {
			return err
		}
		defer removeSnapshotLock(paths)

		connectionInfo, err := config.GetConnectionInfo()
		if errors.Is(err, os.ErrNotExist) {
			// If we cannot get connection info from config file (and it
			// is not specified by the user) then assume main process is
			// not running.
			return wrappedFunction(cmd, args)
		} else if err != nil {
			return fmt.Errorf("failed to get connection info: %w", err)
		}

		// Ensure backend is running if the main process is running at all
		rdClient := client.NewRDClient(connectionInfo)
		state, err := rdClient.GetBackendState()
		if errors.Is(err, syscall.ECONNREFUSED) {
			// If we cannot connect to the server, assume that the main
			// process is not running.
			return wrappedFunction(cmd, args)
		} else if err != nil {
			return fmt.Errorf("failed to get backend state: %w", err)
		}
		if state.VMState != "STARTED" {
			return errors.New("Rancher Desktop must be fully running or fully shut down to do this action")
		}

		// Stop and lock the backend
		desiredState := client.BackendState{
			VMState: "STOPPED",
			Locked:  true,
		}
		if err := rdClient.PutBackendState(desiredState); err != nil {
			return fmt.Errorf("failed to stop backend: %w", err)
		}
		if err := waitForVMState(rdClient, "STOPPED"); err != nil {
			return fmt.Errorf("error waiting for backend to stop: %w", err)
		}

		functionErr := wrappedFunction(cmd, args)

		// Start and unlock the backend
		desiredState = client.BackendState{
			VMState: "STARTED",
			Locked:  false,
		}
		startVMErr := rdClient.PutBackendState(desiredState)
		waitForStartedErr := waitForVMState(rdClient, "STARTED")
		return errors.Join(functionErr, startVMErr, waitForStartedErr)
	}
}

func waitForVMState(rdClient client.RDClient, desiredState string) error {
	interval := 1 * time.Second
	numIntervals := 120
	for i := 0; i < numIntervals; i = i + 1 {
		state, err := rdClient.GetBackendState()
		if err != nil {
			return fmt.Errorf("failed to get backend state: %w", err)
		}
		if state.VMState == desiredState {
			return nil
		}
		time.Sleep(interval)
	}
	return fmt.Errorf("timed out waiting for backend state %q", desiredState)
}

func createSnapshotLock(paths paths.Paths) error {
	if err := os.MkdirAll(paths.AppHome, 0o755); err != nil {
		return fmt.Errorf("failed to create snapshot lock parent directory: %w", err)
	}
	lockPath := filepath.Join(paths.AppHome, "snapshot.lock")
	file, err := os.OpenFile(lockPath, os.O_CREATE|os.O_EXCL, 0o644)
	if errors.Is(err, os.ErrExist) {
		return errors.New("snapshot lock file already exists; if there is no snapshot operation in progress, you and remove this error with `rdctl snapshot clean`")
	} else if err != nil {
		return fmt.Errorf("unexpected error acquiring snapshot lock: %w", err)
	}
	defer file.Close()
	return nil
}

func removeSnapshotLock(paths paths.Paths) error {
	lockPath := filepath.Join(paths.AppHome, "snapshot.lock")
	if err := os.RemoveAll(lockPath); err != nil {
		fmt.Errorf("failed to remove snapshot lock: %w", err)
	}
	return nil
}
