package parsers

import (
	"context"
	"fmt"
	"regexp"
	"time"

	"github.com/rancher-sandbox/rancher-desktop/src/go/startup-profile/model"
)

const networkingLogFile = "networking.log"

func ParseNetworkingLogs(ctx context.Context) ([]*model.Event, error) {
	scanner, err := readRDLogFile(ctx, networkingLogFile)
	if err != nil {
		return nil, err
	}

	var results []*model.Event
	matcher := regexp.MustCompile(`^(\d+-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z): (.*)$`)
	beginMatcher := regexp.MustCompile(`^getting certificates from (.*?)\.{3}$`)
	endMatcher := regexp.MustCompile(`^got certificates from (.*?)$`)
	for scanner.Scan() {
		matches := matcher.FindStringSubmatch(scanner.Text())
		if len(matches) != matcher.NumSubexp()+1 {
			continue
		}
		parsedTime, err := time.Parse(time.RFC3339, matches[1])
		if err != nil {
			return nil, fmt.Errorf("error parsing time: %q: %w", scanner.Text(), err)
		}
		if m := beginMatcher.FindStringSubmatch(matches[2]); len(m) == beginMatcher.NumSubexp()+1 {
			results = append(results, &model.Event{
				Name:      m[1],
				Category:  networkingLogFile,
				Phase:     model.EventPhaseBegin,
				TimeStamp: parsedTime,
			})
		} else if m := endMatcher.FindStringSubmatch(matches[2]); len(m) == endMatcher.NumSubexp()+1 {
			results = append(results, &model.Event{
				Name:      m[1],
				Category:  networkingLogFile,
				Phase:     model.EventPhaseEnd,
				TimeStamp: parsedTime,
			})
		} else {
			results = append(results, &model.Event{
				Name:      matches[2],
				Category:  networkingLogFile,
				Phase:     model.EventPhaseInstant,
				TimeStamp: parsedTime,
			})
		}
	}

	return results, nil
}
