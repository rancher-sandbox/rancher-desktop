package cmd

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"time"

	"github.com/rancher-sandbox/rancher-desktop/src/go/rdctl/pkg/client"
	"github.com/rancher-sandbox/rancher-desktop/src/go/rdctl/pkg/config"
	"github.com/rancher-sandbox/rancher-desktop/src/go/rdctl/pkg/factoryreset"
	"github.com/rancher-sandbox/rancher-desktop/src/go/rdctl/pkg/paths"
	"github.com/spf13/cobra"
)

type errorPayloadType struct {
	Error string `json:"error,omitempty"`
}

var outputJsonFormat bool
var snapshotErrors []error

const backendLockName = "backend.lock"

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
		exitStatus := 0
		for _, snapshotError := range snapshotErrors {
			if snapshotError != nil {
				exitStatus = 1
				errorPayload := errorPayloadType{snapshotError.Error()}
				jsonBuffer, err := json.Marshal(errorPayload)
				if err != nil {
					snapshotErrors = append(snapshotErrors, fmt.Errorf("error json-converting error messages: %w", err))
					return errors.Join(snapshotErrors...)
				}
				fmt.Fprintf(os.Stdout, string(jsonBuffer)+"\n")
			}
		}
		os.Exit(exitStatus)
	}
	return errors.Join(snapshotErrors...)
}

// If the main process is running, stops the backend, calls the
// passed function, and restarts the backend. If it cannot connect
// to the main process, just calls the passed function.
func wrapSnapshotOperation(cmd *cobra.Command, appPaths paths.Paths, resetOnFailure bool, wrappedFunction func() error) error {
	if err := createBackendLock(appPaths.AppHome); err != nil {
		return err
	}
	defer removeBackendLock(appPaths.AppHome)
	if err := ensureBackendStopped(cmd); err != nil {
		return err
	}
	if err := wrappedFunction(); err != nil {
		if resetOnFailure {
			factoryreset.DeleteData(appPaths, true)
			return err
		}
		snapshotErrors = append(snapshotErrors, err)
	}
	// Note that this does not wait for the backend to be in the
	// STARTED (or DISABLED if k8s is disabled) state. This allows
	// removeBackendLock() to be called as a deferred function while
	// keeping the state of the backend lock file in sync with the
	// main process backendIsLocked variable.
	return ensureBackendStarted()
}

func getConnectionInfo() (*config.ConnectionInfo, error) {
	connectionInfo, err := config.GetConnectionInfo()
	// If we cannot get connection info from config file (and it
	// is not specified by the user) then assume main process is
	// not running.
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return nil, nil
		}
		return nil, fmt.Errorf("failed to get connection info: %w", err)
	}
	return connectionInfo, nil
}

func ensureBackendStarted() error {
	connectionInfo, err := getConnectionInfo()
	if err != nil || connectionInfo == nil {
		return err
	}
	rdClient := client.NewRDClient(connectionInfo)
	desiredState := client.BackendState{
		VMState: "STARTED",
		Locked:  false,
	}
	err = rdClient.UpdateBackendState(desiredState)
	if err != nil && !errors.Is(err, client.ErrConnectionRefused) {
		return fmt.Errorf("failed to restart backend: %w", err)
	}
	return nil
}

func ensureBackendStopped(cmd *cobra.Command) error {
	connectionInfo, err := getConnectionInfo()
	if err != nil || connectionInfo == nil {
		return err
	}

	// Ensure backend is running if the main process is running at all
	rdClient := client.NewRDClient(connectionInfo)
	state, err := rdClient.GetBackendState()
	if errors.Is(err, client.ErrConnectionRefused) {
		// If we cannot connect to the server, assume that the main
		// process is not running.
		return nil
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

	return nil
}

// Normally snapshots can be created at state STARTED or DISABLED
func waitForVMState(rdClient client.RDClient, desiredStates []string) error {
	interval := 1 * time.Second
	numIntervals := 120
	for i := 0; i < numIntervals; i = i + 1 {
		state, err := rdClient.GetBackendState()
		if err != nil {
			return fmt.Errorf("failed to poll backend state: %w", err)
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

func createBackendLock(appHome string) error {
	if err := os.MkdirAll(appHome, 0o755); err != nil {
		return fmt.Errorf("failed to create backend lock parent directory: %w", err)
	}
	// Create an empty file whose presence signifies that the
	// backend is locked.
	lockPath := filepath.Join(appHome, backendLockName)
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
