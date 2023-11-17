package snapshot

import "github.com/rancher-sandbox/rancher-desktop/src/go/rdctl/pkg/paths"

// Types that implement Snapshotter are responsible for copying/creating
// files that need to be copied/created for the creation and restoration of
// snapshots.
type Snapshotter interface {
	// Does all of the things that can fail when creating a snapshot,
	// so that the snapshot creation can easily be rolled back upon
	// a failure.
	CreateFiles(appPaths paths.Paths, snapshotDir string) error
	// Like CreateFiles, but for restoring: does all of the things
	// that can fail when restoring a snapshot so that restoration can
	// easily be rolled back in the event of a failure.
	RestoreFiles(appPaths paths.Paths, snapshotDir string) error
}
