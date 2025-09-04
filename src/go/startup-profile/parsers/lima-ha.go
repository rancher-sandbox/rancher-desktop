package parsers

import (
	"bufio"
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"time"

	"github.com/rancher-sandbox/rancher-desktop/src/go/startup-profile/model"
	"github.com/rancher-sandbox/rancher-desktop/src/go/startup-profile/rdctl"
)

func ParseLimaHostAgentLogs(ctx context.Context) ([]*model.Event, error) {
	var paths struct {
		Lima string `json:"lima"`
	}
	stdout, err := rdctl.Rdctl(ctx, "paths")
	if err != nil {
		return nil, fmt.Errorf("failed to get paths: %w", err)
	}
	if err := json.Unmarshal(stdout.Bytes(), &paths); err != nil {
		return nil, fmt.Errorf("failed to unmarshal paths: %w", err)
	}
	if paths.Lima == "" {
		// On Windows, we don't use Lima, so this would not deserialize.
		return nil, nil
	}
	logPath := filepath.Join(paths.Lima, "0", "ha.stderr.log")
	logFile, err := os.Open(logPath)
	if err != nil {
		return nil, fmt.Errorf("failed to open log file %s: %w", logPath, err)
	}
	defer logFile.Close()
	var results []*model.Event
	scanner := bufio.NewScanner(logFile)
	for scanner.Scan() {
		var data struct {
			Level   string    `json:"level"`
			Message string    `json:"msg"`
			Time    time.Time `json:"time"`
		}
		if err := json.Unmarshal(scanner.Bytes(), &data); err != nil {
			// Ignore any lines that are not JSON
			continue
		}
		if !data.Time.IsZero() {
			results = append(results, &model.Event{
				Name:      data.Message,
				Category:  "lima.ha.stderr.log",
				Phase:     model.EventPhaseInstant,
				TimeStamp: data.Time,
			})
		}
	}
	return results, nil
}
