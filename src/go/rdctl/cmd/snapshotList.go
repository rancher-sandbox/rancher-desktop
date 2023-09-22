package cmd

import (
	"encoding/json"
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

var outputJsonFormat bool

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
	Use:     "list",
	Aliases: []string{"ls"},
	Short:   "List snapshots",
	RunE: func(cmd *cobra.Command, args []string) error {
		if err := cobra.NoArgs(cmd, args); err != nil {
			return err
		}
		if snapshot.OutputUTCTime && !outputJsonFormat {
			return fmt.Errorf(`specifying "--utc" makes sense only when "--json" is specified`)
		}
		return listSnapshot()
	},
}

func init() {
	snapshotCmd.AddCommand(snapshotListCmd)
	snapshotListCmd.Flags().BoolVarP(&outputJsonFormat, "json", "", false, "output json format")
	snapshotListCmd.Flags().BoolVarP(&snapshot.OutputUTCTime, "utc", "", false, "output json format")
}

func listSnapshot() error {
	paths, err := paths.GetPaths()
	if err != nil {
		return fmt.Errorf("failed to get paths: %w", err)
	}
	manager := snapshot.NewManager(paths)
	snapshots, err := manager.List()
	if err != nil {
		return fmt.Errorf("failed to list snapshots: %w", err)
	}
	if len(snapshots) == 0 {
		fmt.Fprintln(os.Stderr, "No snapshots present.")
		return nil
	}
	sort.Sort(SortableSnapshots(snapshots))
	if outputJsonFormat {
		return jsonOutput(snapshots)
	}
	return tabularOutput(snapshots)
}

func jsonOutput(snapshots []snapshot.Snapshot) error {
	jsonBuffer, err := json.Marshal(snapshots)
	if err != nil {
		return err
	}
	fmt.Println(string(jsonBuffer))
	return nil
}

func tabularOutput(snapshots []snapshot.Snapshot) error {
	writer := tabwriter.NewWriter(os.Stdout, 0, 4, 4, ' ', 0)
	fmt.Fprintf(writer, "ID\tName\tCreated\n")
	for _, snapshot := range snapshots {
		prettyCreated := snapshot.Created.Format(time.RFC1123)
		fmt.Fprintf(writer, "%s\t%s\t%s\n", snapshot.ID, snapshot.Name, prettyCreated)
	}
	writer.Flush()
	return nil
}
