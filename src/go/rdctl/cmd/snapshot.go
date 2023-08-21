package cmd

import (
	"github.com/spf13/cobra"
)

var snapshotCmd = &cobra.Command{
	Use:    "snapshot",
	Short:  "Manage Rancher Desktop snapshots",
	Hidden: true,
}

func init() {
	rootCmd.AddCommand(snapshotCmd)
}
