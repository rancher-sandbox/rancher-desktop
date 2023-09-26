package snapshot

import (
	"errors"
	"github.com/rancher-sandbox/rancher-desktop/src/go/rdctl/pkg/paths"
)

func getSnapshotFiles(paths paths.Paths, id string) []snapshotFile {
	return []snapshotFile{}
}

func createFiles(paths paths.Paths, snapshot Snapshot) error {
	return errors.New("not implemented")
}

func restoreFiles(files []snapshotFile) error {
	return errors.New("not implemented")
}
