package cmd

import (
	"fmt"

	"github.com/spf13/cobra"
)

var setupSettings struct {
	AutoStart bool
}

var setupCmd = &cobra.Command{
	Hidden: true,
	Use:    "setup",
	Short:  "Configure the system without modifying settings",
	RunE: func(cmd *cobra.Command, args []string) error {
		if cmd.Flags().Changed("application.auto-start") {
			fmt.Printf("Setting autostart to %t", setupSettings.AutoStart)
		}
		return nil
	},
}

func init() {
	rootCmd.AddCommand(setupCmd)
	setupCmd.Flags().BoolVar(&setupSettings.AutoStart, "application.auto-start", false, "Whether to start Rancher Desktop at login")
}
