package parsers

import (
	"bufio"
	"bytes"
	"context"
	"fmt"
	"log"
	"regexp"
	"runtime"
	"time"

	"github.com/rancher-sandbox/rancher-desktop/src/go/startup-profile/model"
	"github.com/rancher-sandbox/rancher-desktop/src/go/startup-profile/rdctl"
)

func ProcessRCLogs(ctx context.Context) ([]*model.Event, error) {
	stdout, err := rdctl.Rdctl(ctx, "shell", "sudo",
		"sh", "-c", "cat /var/log/rc.log || echo 'MISSING'")
	if err != nil {
		return nil, fmt.Errorf("failed to get rc.log: %w", err)
	}
	if bytes.HasPrefix(stdout.Bytes(), []byte("MISSING")) {
		log.Println("Failed to open /var/log/rc.log")
		return nil, nil
	}
	matcher := regexp.MustCompile(`^rc (.*?) logging (started|stopped) at (.*)$`)
	location := time.UTC
	if runtime.GOOS == osWindows {
		location = time.Local
	}
	var results []*model.Event
	scanner := bufio.NewScanner(stdout)
	for scanner.Scan() {
		match := matcher.FindStringSubmatch(scanner.Text())
		if match == nil {
			continue
		}
		level := match[1]
		action := match[2]
		timeStamp, err := time.ParseInLocation(time.ANSIC, match[3], location)
		if err != nil {
			return nil, fmt.Errorf("error parsing time: %q: %w", scanner.Text(), err)
		}
		phase := model.EventPhaseBegin
		if action == "stopped" {
			phase = model.EventPhaseEnd
		}
		results = append(results, &model.Event{
			Name:      fmt.Sprintf("runlevel %s", level),
			Category:  "rc",
			Phase:     phase,
			TimeStamp: timeStamp.UTC(),
		})
	}

	return results, nil
}
