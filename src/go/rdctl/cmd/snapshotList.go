package cmd

import (
	"encoding/json"
	"fmt"
	"os"
	"sort"
	"text/tabwriter"
	"time"

	p "github.com/rancher-sandbox/rancher-desktop/src/go/rdctl/pkg/paths"
	"github.com/rancher-sandbox/rancher-desktop/src/go/rdctl/pkg/snapshot"
	"github.com/spf13/cobra"
)

// SortableSnapshots are []snapshot.Snapshot sortable by date created.
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
	Args:    cobra.NoArgs,
	RunE: func(cmd *cobra.Command, args []string) error {
		return listSnapshot()
	},
}

func init() {
	snapshotCmd.AddCommand(snapshotListCmd)
	snapshotListCmd.Flags().BoolVar(&outputJsonFormat, "json", false, "output json format")
}

func listSnapshot() error {
	paths, err := p.GetPaths()
	if err != nil {
		return fmt.Errorf("failed to get paths: %w", err)
	}
	manager := snapshot.NewManager(paths)
	snapshots, err := manager.List()
	if err != nil {
		return fmt.Errorf("failed to list snapshots: %w", err)
	}
	sort.Sort(SortableSnapshots(snapshots))
	if outputJsonFormat {
		return jsonOutput(snapshots)
	}
	return tabularOutput(snapshots)
}

func jsonOutput(snapshots []snapshot.Snapshot) error {
	for _, aSnapshot := range snapshots {
		jsonBuffer, err := json.Marshal(aSnapshot)
		if err != nil {
			return err
		}
		fmt.Println(string(jsonBuffer))
	}
	return nil
}

func tabularOutput(snapshots []snapshot.Snapshot) error {
	if len(snapshots) == 0 {
		fmt.Fprintln(os.Stderr, "No snapshots present.")
		return nil
	}
	writer := tabwriter.NewWriter(os.Stdout, 0, 4, 4, ' ', 0)
	fmt.Fprintf(writer, "ID\tName\tCreated\n")
	for _, aSnapshot := range snapshots {
		prettyCreated := aSnapshot.Created.Format(time.RFC1123)
		fmt.Fprintf(writer, "%s\t%s\t%s\n", aSnapshot.ID, aSnapshot.Name, prettyCreated)
	}
	writer.Flush()
	return nil
}
