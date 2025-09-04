package parsers

import (
	"bufio"
	"context"
	"fmt"
	"regexp"
	"time"

	"github.com/rancher-sandbox/rancher-desktop/src/go/startup-profile/model"
	"github.com/rancher-sandbox/rancher-desktop/src/go/startup-profile/rdctl"
)

// ParseLimaInitLogs parses /var/log/lima-init.log in a Lima VM.
func ParseLimaInitLogs(ctx context.Context) ([]*model.Event, error) {
	// Run `rdctl shell` to print the lima-init logs; if the file does not exist,
	// still return success (this will be the case on Windows).
	stdout, err := rdctl.Rdctl(ctx, "shell", "sudo",
		"sh", "-c", "cat /var/log/lima-init.log || true")
	if err != nil {
		return nil, fmt.Errorf("failed to get lima-init logs: %w", err)
	}

	var results []*model.Event
	matcher := regexp.MustCompile(`^LIMA ([^|]+)\|\s*(.*)$`)
	scanner := bufio.NewScanner(stdout)
	for scanner.Scan() {
		matches := matcher.FindStringSubmatch(scanner.Text())
		if len(matches) < 3 {
			continue
		}
		date, err := time.Parse(time.RFC3339, matches[1])
		if err != nil {
			return nil, fmt.Errorf("error parsing time: %q: %w", scanner.Text(), err)
		}
		results = append(results, &model.Event{
			Name:      matches[2],
			Category:  "lima-init",
			Phase:     model.EventPhaseInstant,
			TimeStamp: date,
		})
	}

	return results, nil
}
