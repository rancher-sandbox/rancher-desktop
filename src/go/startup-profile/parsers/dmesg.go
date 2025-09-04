package parsers

import (
	"bufio"
	"context"
	"fmt"
	"regexp"
	"runtime"
	"strconv"
	"strings"
	"time"

	"github.com/rancher-sandbox/rancher-desktop/src/go/startup-profile/model"
	"github.com/rancher-sandbox/rancher-desktop/src/go/startup-profile/rdctl"
)

// Parse `dmesg` output
func ParseDmesg(ctx context.Context) ([]*model.Event, error) {
	if runtime.GOOS == osWindows {
		// dmesg isn't useful on Windows, because we use WSL2 there so messages may
		// be related to a different distribution.
		return nil, nil
	}
	_, err := rdctl.Rdctl(ctx, "shell", "sudo",
		"sh", "-c", "date -u +'@@STOP@@ %FT%TZ' >> /dev/kmsg") // spellcheck-ignore-line
	if err != nil {
		return nil, fmt.Errorf("failed to mark timestamp in dmesg: %w", err)
	}
	stdout, err := rdctl.Rdctl(ctx, "shell", "sudo", "dmesg")
	if err != nil {
		return nil, fmt.Errorf("failed to get dmesg: %w", err)
	}
	lineMatcher := regexp.MustCompile(`^\[\s*(\d+\.\d+)\] (.*)$`)
	ignoreMatcher := regexp.MustCompile(`^(?:audit:|cni0:|veth[0-9a-f]+:|kauditd_printk_skb)`)
	var timeOffset time.Time
	scanner := bufio.NewScanner(stdout)
	type entry struct {
		offset  int64
		message string
	}
	var entries []entry
	for scanner.Scan() {
		lineMatch := lineMatcher.FindStringSubmatch(scanner.Text())
		if len(lineMatch) != 3 {
			continue
		}
		if strings.HasPrefix(lineMatch[2], "@@STOP@@ ") {
			offset, err := strconv.ParseFloat(lineMatch[1], 64)
			if err != nil {
				return nil, fmt.Errorf("error parsing time offset: %q: %w", scanner.Text(), err)
			}
			timeOffset, err = time.Parse(time.RFC3339, lineMatch[2][len("@@STOP@@ "):])
			if err != nil {
				return nil, fmt.Errorf("error parsing current time: %w", err)
			}
			timeOffset = timeOffset.Add(-time.Duration(int64(offset * float64(time.Second))))
			break
		}
		if ignoreMatcher.MatchString(lineMatch[2]) {
			// Skip uninteresting line.
			continue
		}
		offset, err := strconv.ParseFloat(lineMatch[1], 64)
		if err != nil {
			return nil, fmt.Errorf("error parsing time offset: %q: %w", scanner.Text(), err)
		}
		entries = append(entries, entry{offset: int64(offset * float64(time.Second)), message: lineMatch[2]})
	}

	if timeOffset.IsZero() {
		return nil, fmt.Errorf("failed to find time offset")
	}
	results := make([]*model.Event, 0, len(entries))
	for _, entry := range entries {
		results = append(results, &model.Event{
			Name:      entry.message,
			Category:  "dmesg",
			Phase:     model.EventPhaseInstant,
			TimeStamp: timeOffset.Add(time.Duration(entry.offset)),
		})
	}
	return results, nil
}
