package cmd

import (
	"encoding/json"
	"fmt"
	"os"

	"github.com/spf13/cobra"
)

type errorPayloadType struct {
	Error string `json:"error,omitempty"`
}

var outputJsonFormat bool

var snapshotCmd = &cobra.Command{
	Use:   "snapshot",
	Short: "Manage Rancher Desktop snapshots",
}

func init() {
	rootCmd.AddCommand(snapshotCmd)
}

func exitWithJsonOrErrorCondition(e error) error {
	if outputJsonFormat {
		exitStatus := 0
		if e != nil {
			exitStatus = 1
			errorPayload := errorPayloadType{e.Error()}
			jsonBuffer, err := json.Marshal(errorPayload)
			if err != nil {
				return fmt.Errorf("error json-converting error messages: %w", err)
			}
			fmt.Fprintln(os.Stdout, string(jsonBuffer))
		}
		os.Exit(exitStatus)
	}
	return e
}
