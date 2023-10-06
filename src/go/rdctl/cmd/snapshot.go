package cmd

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"syscall"
	"time"

	"github.com/rancher-sandbox/rancher-desktop/src/go/rdctl/pkg/client"
	"github.com/rancher-sandbox/rancher-desktop/src/go/rdctl/pkg/config"
	"github.com/rancher-sandbox/rancher-desktop/src/go/rdctl/pkg/paths"
	"github.com/spf13/cobra"
)

type errorPayloadType struct {
	Error string `json:"error,omitempty"`
}

var outputJsonFormat bool
var snapshotErrors []error

const backendLockName = "backend.lock"

type cobraFunc func(cmd *cobra.Command, args []string) error

var snapshotCmd = &cobra.Command{
	Use:    "snapshot",
	Short:  "Manage Rancher Desktop snapshots",
	Hidden: true,
}

func init() {
	rootCmd.AddCommand(snapshotCmd)
	snapshotErrors = make([]error, 0)
}

func exitWithJsonOrErrorCondition(e error) error {
	if e != nil {
		snapshotErrors = append(snapshotErrors, e)
	}
	if outputJsonFormat {
		for _, snapshotError := range snapshotErrors {
			if snapshotError != nil {
				errorPayload := errorPayloadType{snapshotError.Error() }
				jsonBuffer, err := json.Marshal(errorPayload)
				if err != nil {
					return fmt.Errorf("error json-converting error messages: %w", err)
				}
				fmt.Fprintf(os.Stdout, string(jsonBuffer)+"\n")
			}
		}
		return nil
	} else {
		return errors.Join(snapshotErrors...)
	}
}

// If the main process is running, stops the backend, calls the
// passed function, and restarts the backend. If it cannot connect
// to the main process, just calls the passed function.
func wrapSnapshotOperation(wrappedFunction cobraFunc) cobraFunc {
	return func(cmd *cobra.Command, args []string) error {
		appPaths, err := paths.GetPaths()
		if err != nil {
			return fmt.Errorf("failed to get paths: %w", err)
		}
		if err := createBackendLock(appPaths); err != nil {
			return err
		}
		defer removeBackendLock(appPaths.AppHome)

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
		if state.VMState != "STARTED" && state.VMState != "DISABLED" {
			return fmt.Errorf("Rancher Desktop must be fully running or fully shut down to do a snapshot-%s action, state is currently %v", cmd.Name(), state.VMState)
		}

		// Stop and lock the backend
		desiredState := client.BackendState{
			VMState: "STOPPED",
			Locked:  true,
		}
		if err := rdClient.UpdateBackendState(desiredState); err != nil {
			return fmt.Errorf("failed to stop backend: %w", err)
		}
		if err := waitForVMState(rdClient, []string{"STOPPED"}); err != nil {
			return fmt.Errorf("error waiting for backend to stop: %w", err)
		}

		functionErr := wrappedFunction(cmd, args)
		if functionErr != nil {
			snapshotErrors = append(snapshotErrors, functionErr)
		}

		// Start and unlock the backend
		desiredState = client.BackendState{
			VMState: "STARTED",
			Locked:  false,
		}
		startVMErr := rdClient.UpdateBackendState(desiredState)
		if startVMErr != nil {
			snapshotErrors = append(snapshotErrors, startVMErr)
		}

		waitForStartedErr := waitForVMState(rdClient, []string{"STARTED", "DISABLED"})
		if waitForStartedErr != nil {
			snapshotErrors = append(snapshotErrors, waitForStartedErr)
		}
		return nil
	}
}

// Normally snapshots can be created at state STARTED or DISABLED
func waitForVMState(rdClient client.RDClient, desiredStates []string) error {
	interval := 1 * time.Second
	numIntervals := 120
	for i := 0; i < numIntervals; i = i + 1 {
		state, err := rdClient.GetBackendState()
		if err != nil {
			return fmt.Errorf("failed to get backend state: %w", err)
		}
		for _, desiredState := range desiredStates {
			if state.VMState == desiredState {
				return nil
			}
		}
		time.Sleep(interval)
	}
	return fmt.Errorf("timed out waiting for backend state in %s", desiredStates)
}

func createBackendLock(appPaths paths.Paths) error {
	if err := os.MkdirAll(appPaths.AppHome, 0o755); err != nil {
		return fmt.Errorf("failed to create backend lock parent directory: %w", err)
	}
	// Create an empty file whose presence signifies that the
	// backend is locked.
	lockPath := filepath.Join(appPaths.AppHome, backendLockName)
	file, err := os.OpenFile(lockPath, os.O_CREATE|os.O_EXCL, 0o644)
	if errors.Is(err, os.ErrExist) {
		return errors.New("backend lock file already exists; if there is no snapshot operation in progress, you can remove this error with `rdctl snapshot unlock`")
	} else if err != nil {
		return fmt.Errorf("unexpected error acquiring backend lock: %w", err)
	}
	if err := file.Close(); err != nil {
		fmt.Fprintf(os.Stderr, "failed to close backend lock file descriptor: %s", err)
	}
	return nil
}

func removeBackendLock(appHome string) error {
	lockPath := filepath.Join(appHome, backendLockName)
	if err := os.RemoveAll(lockPath); err != nil {
		return fmt.Errorf("failed to remove backend lock: %w", err)
	}
	return nil
}
