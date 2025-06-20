package cmd

import (
	"encoding/json"
	"fmt"
	"os"
	"sort"
	"strings"
	"text/tabwriter"
	"time"

	"github.com/spf13/cobra"

	"github.com/rancher-sandbox/rancher-desktop/src/go/rdctl/pkg/snapshot"
)

const (
	// The maximum number of runes to output for tabular output.
	tableMaxRunes = 63
)

// SortableSnapshots are []snapshot.Snapshot sortable by date created.
type SortableSnapshots []snapshot.Snapshot

func (snapshots SortableSnapshots) Len() int {
	return len(snapshots)
}

func (snapshots SortableSnapshots) Less(i, j int) bool {
	return snapshots[i].Created.Sub(snapshots[j].Created) < 0
}

func (snapshots SortableSnapshots) Swap(i, j int) {
	snapshots[i], snapshots[j] = snapshots[j], snapshots[i]
}

var snapshotListCmd = &cobra.Command{
	Use:     "list",
	Aliases: []string{"ls"},
	Short:   "List snapshots",
	Args:    cobra.NoArgs,
	RunE: func(cmd *cobra.Command, args []string) error {
		cmd.SilenceUsage = true
		return exitWithJSONOrErrorCondition(listSnapshot())
	},
}

func init() {
	snapshotCmd.AddCommand(snapshotListCmd)
	snapshotListCmd.Flags().BoolVar(&outputJSONFormat, "json", false, "output json format")
}

func listSnapshot() error {
	manager, err := snapshot.NewManager()
	if err != nil {
		return fmt.Errorf("failed to create snapshot manager: %w", err)
	}
	snapshots, err := manager.List(false)
	if err != nil {
		return fmt.Errorf("failed to list snapshots: %w", err)
	}
	sort.Sort(SortableSnapshots(snapshots))
	if outputJSONFormat {
		return jsonOutput(snapshots)
	}
	return tabularOutput(snapshots)
}

func jsonOutput(snapshots []snapshot.Snapshot) error {
	for _, aSnapshot := range snapshots {
		aSnapshot.ID = ""
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
	fmt.Fprintf(writer, "NAME\tCREATED\tDESCRIPTION\n")
	for _, aSnapshot := range snapshots {
		prettyCreated := aSnapshot.Created.Format(time.RFC1123)
		desc := truncateAtNewlineOrMaxRunes(aSnapshot.Description, tableMaxRunes)
		fmt.Fprintf(writer, "%s\t%s\t%s\n", aSnapshot.Name, prettyCreated, desc)
	}
	writer.Flush()
	return nil
}

// Truncates a string to either the first newline or a maximum number of
// runes. Also removes leading and trailing whitespace.
func truncateAtNewlineOrMaxRunes(input string, maxRunes int) string {
	truncated := false
	input = strings.TrimSpace(input)
	if newlineIndex := strings.Index(input, "\n"); newlineIndex >= 0 {
		input = input[:newlineIndex]
		truncated = true
	}
	runeInput := []rune(input)
	if len(runeInput) > maxRunes-1 {
		runeInput = runeInput[:maxRunes-1]
		truncated = true
	}
	if truncated {
		return string(runeInput) + "…"
	}
	return string(runeInput)
}
