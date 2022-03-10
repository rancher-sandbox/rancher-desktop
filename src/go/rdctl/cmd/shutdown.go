/*
Copyright © 2022 NAME HERE <EMAIL ADDRESS>

*/
package cmd

import (
	"github.com/spf13/cobra"
)

// shutdownCmd represents the shutdown command
var shutdownCmd = &cobra.Command{
	Use:   "shutdown",
	Short: "Shuts down the running Rancher Desktop app",
	Long: `Shuts down the running Rancher Desktop app.`,
	RunE: func(cmd *cobra.Command, args []string) error {
    return doRequest("PUT", "shutdown")
	},
}

func init() {
	rootCmd.AddCommand(shutdownCmd)
}
