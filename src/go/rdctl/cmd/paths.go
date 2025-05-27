package cmd

import (
	"encoding/json"
	"fmt"
	"os"

	"github.com/spf13/cobra"

	p "github.com/rancher-sandbox/rancher-desktop/src/go/rdctl/pkg/paths"
)

var pathsCmd = &cobra.Command{
	Hidden: true,
	Use:    "paths",
	Short:  "Print the paths to directories that Rancher Desktop uses",
	RunE: func(cmd *cobra.Command, args []string) error {
		paths, err := p.GetPaths()
		if err != nil {
			return fmt.Errorf("failed to construct Paths: %w", err)
		}
		encoder := json.NewEncoder(os.Stdout)
		err = encoder.Encode(paths)
		if err != nil {
			return fmt.Errorf("failed to output paths: %w", err)
		}
		return nil
	},
}

func init() {
	rootCmd.AddCommand(pathsCmd)
}
