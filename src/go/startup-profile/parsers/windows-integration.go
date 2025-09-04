package parsers

import (
	"context"
	"fmt"
	"regexp"
	"runtime"
	"time"

	"github.com/rancher-sandbox/rancher-desktop/src/go/startup-profile/model"
)

func ParseWindowsIntegrationLogs(ctx context.Context) ([]*model.Event, error) {
	if runtime.GOOS != osWindows {
		return nil, nil
	}

	scanner, err := readRDLogFile(ctx, "integrations.log")
	if err != nil {
		return nil, err
	}

	var results []*model.Event
	matcher := regexp.MustCompile(`^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z):\s+(.*)$`)
	for scanner.Scan() {
		matches := matcher.FindStringSubmatch(scanner.Text())
		if len(matches) != matcher.NumSubexp()+1 {
			continue
		}
		timestamp, err := time.Parse(time.RFC3339, matches[1])
		if err != nil {
			return nil, fmt.Errorf("error parsing time: %q: %w", scanner.Text(), err)
		}
		results = append(results, &model.Event{
			Name:      matches[2],
			Category:  "integrations",
			Phase:     model.EventPhaseInstant,
			TimeStamp: timestamp,
		})
	}

	return results, nil
}
