/*
Copyright © 2022 NAME HERE <EMAIL ADDRESS>

*/
package cmd

import (
	"github.com/spf13/cobra"
)

// listSettingsCmd represents the listSettings command
var listSettingsCmd = &cobra.Command{
	Use:   "list-settings",
	Short: "Lists the current settings.",
	Long: `Lists the current settings in JSON format.`,
  RunE: func(cmd *cobra.Command, args []string) error {
    return doRequest("GET", "list-settings")
  },
}

func init() {
	rootCmd.AddCommand(listSettingsCmd)
}
