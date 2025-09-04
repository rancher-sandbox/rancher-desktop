package parsers

import (
	"context"
	"fmt"
	"regexp"
	"runtime"
	"time"

	"github.com/rancher-sandbox/rancher-desktop/src/go/startup-profile/model"
)

// ParseProgress parses the Rancher Desktop backend logs for progress tracker
// events.
func ParseProgress(ctx context.Context) ([]*model.Event, error) {
	logName := "lima.log"
	if runtime.GOOS == osWindows {
		logName = "wsl.log"
	}

	scanner, err := readRDLogFile(ctx, logName)
	if err != nil {
		return nil, err
	}

	var results []*model.Event
	matcher := regexp.MustCompile(`^(\d+.*?Z): Progress: (started|finished) (.*)$`)
	for scanner.Scan() {
		matches := matcher.FindStringSubmatch(scanner.Text())
		if len(matches) < matcher.NumSubexp()+1 {
			continue
		}
		date := matches[1]
		state := matches[2]
		description := matches[3]

		parsedTime, err := time.Parse(time.RFC3339, date)
		if err != nil {
			return nil, fmt.Errorf("error parsing time: %q: %w", scanner.Text(), err)
		}
		phase := model.EventPhaseBegin
		if state == "finished" {
			phase = model.EventPhaseEnd
		}
		results = append(results, &model.Event{
			Name:      description,
			Category:  logName,
			Phase:     phase,
			TimeStamp: parsedTime,
		})
	}
	return results, nil
}
