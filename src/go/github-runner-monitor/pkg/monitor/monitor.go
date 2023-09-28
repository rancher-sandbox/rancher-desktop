/*
Copyright © 2023 SUSE LLC

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
*/

package monitor

import (
	"context"
	"fmt"
	"sync"
	"time"

	"github.com/google/go-github/v55/github"
	"github.com/rancher-sandbox/rancher-desktop/src/go/github-runner-monitor/pkg/machines"
	"github.com/sirupsen/logrus"
)

// Configuration for monitor, including configuration for VMs to spawn.
type Config struct {
	RunnerCount   int           // The number of runners to be kept at once.
	CheckInterval time.Duration // Amount of time between checks.
	AuthToken     string        // GitHub authentication token
	Owner         string        // GitHub repository owner
	Repo          string        // GitHub repository name
	Labels        []string      // Labels that our runners would have
	Cpus          int           // Number of CPUs per VM
	Memory        int           // Amount of memory per VM, in megabytes
	Disk          string        // Disk image to use for runners
}

// Monitor the GitHub repository and spawn new VMs when the number of active
// runners is less than the configured amount.
func Monitor(ctx context.Context, c Config) error {
	client := github.NewClient(nil).WithAuthToken(c.AuthToken)
	wg := &sync.WaitGroup{}

	if err := monitorOnce(ctx, c, client, wg); err != nil {
		logrus.WithError(err).Error("failed to monitor")
	}

monitorLoop:
	for {
		select {
		case <-ctx.Done():
			break monitorLoop
		case <-time.After(c.CheckInterval):
			if err := monitorOnce(ctx, c, client, wg); err != nil {
				logrus.WithError(err).Error("failed to monitor")
			}
		}
	}
	wg.Wait()
	return nil
}

// monitorOnce runs one iteration of the monitor loop.  The wait group will be
// added to before creating the GitHub-side runner record, and removed once that
// has been removed.  This is used to ensure we do not end up exiting before we
// clean up.
func monitorOnce(ctx context.Context, c Config, client *github.Client, wg *sync.WaitGroup) error {
	runners, _, err := client.Actions.ListRunners(ctx, c.Owner, c.Repo, nil)
	if err != nil {
		return fmt.Errorf("failed to retrieve list of runners: %w", err)
	}
	runnerCount := 0

	logrus.Tracef("Got %d runners", runners.TotalCount)

runnerLoop:
	for _, runner := range runners.Runners {
		for _, wantedLabel := range c.Labels {
			found := false
			for _, label := range runner.Labels {
				if label.GetName() == wantedLabel {
					found = true
					break
				}
			}
			if !found {
				continue runnerLoop
			}
		}
		runnerCount += 1
	}

	if runnerCount >= c.RunnerCount {
		logrus.Tracef("Got %d/%d runners, not adding new ones.", runnerCount, c.RunnerCount)
		return nil
	}

	logrus.Tracef("Got %d/%d runners, creating new runner", runnerCount, c.RunnerCount)

	succeeded := false

	name := fmt.Sprintf("linux-%s", time.Now().Format("2006-01-02T15-04-05"))
	wg.Add(1)
	config, _, err := client.Actions.GenerateRepoJITConfig(ctx, c.Owner, c.Repo, &github.GenerateJITConfigRequest{
		Name:          name,
		Labels:        c.Labels,
		RunnerGroupID: 1,
	})
	if err != nil {
		wg.Done()
		return fmt.Errorf("failed to get runner config: %w", err)
	}
	removeRunner := func() {
		runner := config.GetRunner()
		if runner != nil {
			// Don't use the given context; that might have been cancelled (and
			// lead to us removing the runner).  Use a new background context
			// instead.
			logrus.Tracef("Unregistering runner %s", name)
			_, err := client.Actions.RemoveRunner(context.Background(), c.Owner, c.Repo, runner.GetID())
			if err != nil {
				logrus.WithError(err).Error("Failed to unregister runner")
			}
		}
		wg.Done()
	}
	defer func() {
		if !succeeded {
			removeRunner()
		}
	}()
	configString := config.GetEncodedJITConfig()
	if configString == "" {
		return fmt.Errorf("got invalid runner config")
	}
	machineDone, err := machines.Run(ctx, machines.Config{
		Name:      name,
		Cpus:      fmt.Sprintf("%d", c.Cpus),
		Memory:    fmt.Sprintf("%dM", c.Memory),
		Disk:      c.Disk,
		JitConfig: configString,
	})
	if err != nil {
		return fmt.Errorf("failed to create machine")
	}

	succeeded = true
	go func() {
		<-machineDone
		removeRunner()
	}()

	logrus.Tracef("Created runner %s", name)

	return nil
}
