package parsers

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
	"regexp"
	"time"

	"github.com/rancher-sandbox/rancher-desktop/src/go/startup-profile/model"
)

func ParseWSLHelperLogs(ctx context.Context) ([]*model.Event, error) {
	scanner, err := readRDLogFile(ctx, "wsl-helper.log")
	if err != nil {
		if errors.Is(err, fs.ErrNotExist) {
			return nil, nil
		}
		return nil, err
	}

	var results []*model.Event
	matcher := regexp.MustCompile(`^time="(.*?)" level=(\w+) msg=(".*?"|[^"]\w+)`)
	for scanner.Scan() {
		matches := matcher.FindStringSubmatch(scanner.Text())
		if len(matches) != matcher.NumSubexp()+1 {
			continue
		}

		if matches[2] == "debug" {
			continue
		}

		timestamp, err := time.Parse(time.RFC3339, matches[1])
		if err != nil {
			return nil, fmt.Errorf("error parsing time: %q: %w", scanner.Text(), err)
		}

		msg := matches[3]
		var result string
		if err := json.Unmarshal([]byte(msg), &result); err == nil {
			msg = result
		}

		results = append(results, &model.Event{
			Name:      msg,
			Category:  "wsl-helper",
			Phase:     model.EventPhaseInstant,
			TimeStamp: timestamp,
		})
	}

	return results, nil
}
