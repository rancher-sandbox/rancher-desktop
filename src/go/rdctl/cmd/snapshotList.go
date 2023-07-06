package cmd

import (
	"fmt"
	"os"
	"sort"
	"text/tabwriter"
	"time"

	"github.com/rancher-sandbox/rancher-desktop/src/go/rdctl/pkg/paths"
	"github.com/rancher-sandbox/rancher-desktop/src/go/rdctl/pkg/snapshot"
	"github.com/spf13/cobra"
)

// Like []snapshot.Snapshot but sortable by date created.
type SortableSnapshots []snapshot.Snapshot

func (snapshots SortableSnapshots) Len() int {
	return len(snapshots)
}

func (snapshots SortableSnapshots) Less(i, j int) bool {
	return snapshots[i].Created.Sub(snapshots[j].Created) < 0
}

func (snapshots SortableSnapshots) Swap(i, j int) {
	temp := snapshots[i]
	snapshots[i] = snapshots[j]
	snapshots[j] = temp
}

var snapshotListCmd = &cobra.Command{
	Use:   "list",
	Short: "List snapshots",
	RunE: func(cmd *cobra.Command, args []string) error {
		paths, err := paths.GetPaths()
		if err != nil {
			return fmt.Errorf("failed to get paths: %w", err)
		}
		manager := snapshot.NewManager(paths)
		snapshots, err := manager.List()
		if err != nil {
			return fmt.Errorf("failed to list snapshots: %w", err)
		}
		sort.Sort(SortableSnapshots(snapshots))
		writer := tabwriter.NewWriter(os.Stdout, 0, 4, 4, ' ', 0)
		fmt.Fprintf(writer, "ID\tName\tCreated\n")
		for _, snapshot := range snapshots {
			prettyCreated := snapshot.Created.Format(time.RFC1123)
			fmt.Fprintf(writer, "%s\t%s\t%s\n", snapshot.ID, snapshot.Name, prettyCreated)
		}
		writer.Flush()
		return nil
	},
}

func init() {
	snapshotCmd.AddCommand(snapshotListCmd)
}
