package lock

import (
	"errors"
	"fmt"
	"github.com/rancher-sandbox/rancher-desktop/src/go/rdctl/pkg/client"
	"github.com/rancher-sandbox/rancher-desktop/src/go/rdctl/pkg/config"
	"github.com/rancher-sandbox/rancher-desktop/src/go/rdctl/pkg/paths"
	"os"
	"path/filepath"
	"time"
)

const backendLockName = "backend.lock"

// Lock the backend by creating the lock file and shutting down the VM.
// The lock file will be deleted if Lock returns an error (e.g. the backend couldn't be stopped).
func Lock(appPaths paths.Paths, action string) error {
	if err := os.MkdirAll(appPaths.AppHome, 0o755); err != nil {
		return fmt.Errorf("failed to create backend lock parent directory %q: %w", appPaths.AppHome, err)
	}
	// Create an empty file whose presence signifies that the backend is locked.
	lockPath := filepath.Join(appPaths.AppHome, backendLockName)
	file, err := os.OpenFile(lockPath, os.O_CREATE|os.O_EXCL, 0o644)
	if errors.Is(err, os.ErrExist) {
		return errors.New("backend lock file already exists; if there is no snapshot operation in progress, you can remove this error with `rdctl snapshot unlock`")
	} else if err != nil {
		return fmt.Errorf("unexpected error acquiring backend lock: %w", err)
	}
	if err := file.Close(); err != nil {
		_, _ = fmt.Fprintf(os.Stderr, "failed to close backend lock file descriptor: %s", err)
	}
	err = ensureBackendStopped(action)
	if err != nil {
		_ = os.Remove(lockPath)
	}
	return err
}

// Unlock the backend by removing the lock file. Restart the VM if the file was deleted and `restart` is true.
func Unlock(appPaths paths.Paths, restart bool) error {
	lockPath := filepath.Join(appPaths.AppHome, backendLockName)
	err := os.RemoveAll(lockPath)
	if err == nil && restart {
		err = ensureBackendStarted()
	}
	return err
}

func ensureBackendStarted() error {
	connectionInfo, err := config.GetConnectionInfo(true)
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

func ensureBackendStopped(action string) error {
	connectionInfo, err := config.GetConnectionInfo(true)
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
		return fmt.Errorf("Rancher Desktop must be fully running or fully shut down to do a snapshot-%s action, state is currently %v", action, state.VMState)
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
