package cmd

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"

	"github.com/rancher-sandbox/rancher-desktop/src/go/rdctl/pkg/snapshot"
	"github.com/spf13/cobra"
)

type errorPayloadType struct {
	// The error message.
	Error string `json:"error,omitempty"`
	// Whether a data reset was done as a result of the error.
	DataReset bool `json:"dataReset,omitempty"`
}

var outputJSONFormat bool

var snapshotCmd = &cobra.Command{
	Use:   "snapshot",
	Short: "Manage Rancher Desktop snapshots",
}

func init() {
	rootCmd.AddCommand(snapshotCmd)
}

func exitWithJSONOrErrorCondition(e error) error {
	if outputJSONFormat {
		exitStatus := 0
		if e != nil {
			exitStatus = 1
			errorPayload := errorPayloadType{
				Error:     e.Error(),
				DataReset: errors.Is(e, snapshot.ErrDataReset),
			}
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
