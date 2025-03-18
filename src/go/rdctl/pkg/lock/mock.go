package lock

import (
	"context"

	"github.com/rancher-sandbox/rancher-desktop/src/go/rdctl/pkg/paths"
)

type MockBackendLock struct {
}

func (lock *MockBackendLock) Lock(ctx context.Context, appPaths *paths.Paths, action string) error {
	return nil
}

func (lock *MockBackendLock) Unlock(ctx context.Context, appPaths *paths.Paths, restart bool) error {
	return nil
}
