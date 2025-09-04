package main

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"os"
	"sync"

	"golang.org/x/sync/errgroup"

	"github.com/rancher-sandbox/rancher-desktop/src/go/startup-profile/model"
	"github.com/rancher-sandbox/rancher-desktop/src/go/startup-profile/parsers"
	"github.com/rancher-sandbox/rancher-desktop/src/go/startup-profile/render"
)

func run(ctx context.Context, outPath marshalledPath) error {
	// Normalize the output path, in case it's still the default value.
	if err := outPath.UnmarshalText([]byte(outPath)); err != nil {
		return fmt.Errorf("error normalizing output path %s: %w", outPath, err)
	}

	// Set up the channel we will use to read events
	mutex := sync.Mutex{}
	events := make([]*model.Event, 0, 1024)
	group, ctx := errgroup.WithContext(context.Background())

	// Run the individual data collectors
	processors := map[string]parsers.Parser{
		"lima":                parsers.ParseLimaInitLogs,
		"progress":            parsers.ParseProgress,
		"dmesg":               parsers.ParseDmesg,
		"openrc":              parsers.ProcessRCLogs,
		"host-agent":          parsers.ParseLimaHostAgentLogs,
		"networking":          parsers.ParseNetworkingLogs,
		"windows-guest-agent": parsers.ParseWindowsGuestAgentLogs,
		"windows-integration": parsers.ParseWindowsIntegrationLogs,
		"wsl-helper":          parsers.ParseWSLHelperLogs,
	}

	for name, p := range processors {
		group.Go(func() error {
			results, err := p(ctx)
			if err != nil {
				return err
			}
			if err := render.ProcessSource(ctx, name, results); err != nil {
				return err
			}
			mutex.Lock()
			events = append(events, results...)
			mutex.Unlock()
			slog.InfoContext(ctx, "got events", "source", name, "count", len(results))
			return nil
		})
	}

	if err := group.Wait(); err != nil {
		return err
	}
	if len(events) < 1 {
		return fmt.Errorf("no events found")
	}

	// Emit the output
	data, err := render.Render(ctx, events)
	if err != nil {
		return err
	}
	outFile, err := os.Create(string(outPath))
	if err != nil {
		return fmt.Errorf("failed to create output file %s: %w", outPath, err)
	}
	encoder := json.NewEncoder(outFile)
	encoder.SetIndent("", "  ")
	if err := encoder.Encode(data); err != nil {
		return fmt.Errorf("failed to encode events: %w", err)
	}
	if err := outFile.Close(); err != nil {
		return fmt.Errorf("failed to flush output file %s: %w", outPath, err)
	}
	return nil
}
