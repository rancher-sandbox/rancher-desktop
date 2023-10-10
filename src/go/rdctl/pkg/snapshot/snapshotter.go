package snapshot

// Types that implement Snapshotter are responsible for copying/creating
// files that need to be copied/created for the creation and restoration of
// snapshots.
type Snapshotter interface {
	CreateFiles(snapshot Snapshot) error
	RestoreFiles(snapshot Snapshot) error
}
