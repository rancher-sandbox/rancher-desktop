package cmd

import (
	"errors"

	"github.com/spf13/cobra"

	"github.com/rancher-sandbox/rancher-desktop/src/go/rdctl/pkg/autostart"
)

var setupSettings struct {
	AutoStart bool
}

var setupCmd = &cobra.Command{
	Hidden: true,
	Use:    "setup",
	Short:  "Configure the system without modifying settings",
	RunE: func(cmd *cobra.Command, args []string) error {
		if cmd.Flags().Changed("auto-start") {
			return autostart.EnsureAutostart(cmd.Context(), setupSettings.AutoStart)
		}
		return errors.New("no changes were specified")
	},
}

func init() {
	rootCmd.AddCommand(setupCmd)
	setupCmd.Flags().BoolVar(&setupSettings.AutoStart, "auto-start", false, "Whether to start Rancher Desktop at login")
}
