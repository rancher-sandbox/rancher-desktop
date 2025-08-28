package parsers

import (
	"bufio"
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"

	"github.com/rancher-sandbox/rancher-desktop/src/go/startup-profile/model"
	"github.com/rancher-sandbox/rancher-desktop/src/go/startup-profile/rdctl"
)

// A Parser is a function that processes some kind of log file and emits events
// into the provided channel.
type Parser func(context.Context) ([]*model.Event, error)

// Given the name of a log file, return a scanner that reads from the given file
// in the Rancher Desktop logs directory.
func readRDLogFile(ctx context.Context, name string) (*bufio.Scanner, error) {
	var paths struct {
		Logs string `json:"logs"`
	}
	stdout, err := rdctl.Rdctl(ctx, "paths")
	if err != nil {
		return nil, fmt.Errorf("failed to get paths: %w", err)
	}
	if err := json.Unmarshal(stdout.Bytes(), &paths); err != nil {
		return nil, fmt.Errorf("failed to unmarshal paths: %w", err)
	}
	logPath := filepath.Join(paths.Logs, name)
	logFile, err := os.Open(logPath)
	if err != nil {
		return nil, fmt.Errorf("failed to open log file %s: %w", logPath, err)
	}

	go func() {
		<-ctx.Done()
		_ = logFile.Close()
	}()

	return bufio.NewScanner(logFile), nil
}
