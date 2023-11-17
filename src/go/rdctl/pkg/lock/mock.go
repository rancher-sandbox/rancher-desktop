package lock

import "github.com/rancher-sandbox/rancher-desktop/src/go/rdctl/pkg/paths"

type MockBackendLock struct {
}

func (lock *MockBackendLock) Lock(appPaths paths.Paths, action string) error {
	return nil
}

func (lock *MockBackendLock) Unlock(appPaths paths.Paths, restart bool) error {
	return nil
}
