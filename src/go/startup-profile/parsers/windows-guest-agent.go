package parsers

import (
	"context"
	"fmt"
	"regexp"
	"runtime"
	"time"

	"github.com/rancher-sandbox/rancher-desktop/src/go/startup-profile/model"
)

func ParseWindowsGuestAgentLogs(ctx context.Context) ([]*model.Event, error) {
	if runtime.GOOS != osWindows {
		return nil, nil
	}

	scanner, err := readRDLogFile(ctx, "rancher-desktop-guestagent.log")
	if err != nil {
		return nil, err
	}

	var results []*model.Event
	matcher := regexp.MustCompile(`^(\d{4}/\d{2}/\d{2}\s+\d{2}:\d{2}:\d{2})\s+\[.*?\]\s+(.*)$`)
	for scanner.Scan() {
		matches := matcher.FindStringSubmatch(scanner.Text())
		if len(matches) != matcher.NumSubexp()+1 {
			continue
		}
		timestamp, err := time.ParseInLocation("2006/01/02 15:04:05", matches[1], time.Local)
		if err != nil {
			return nil, fmt.Errorf("error parsing time: %q: %w", scanner.Text(), err)
		}
		results = append(results, &model.Event{
			Name:      matches[2],
			Category:  "guest-agent",
			Phase:     model.EventPhaseInstant,
			TimeStamp: timestamp,
		})
	}

	return results, nil
}
