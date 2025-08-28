package render

import (
	"cmp"
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"os"
	"slices"
	"time"

	"github.com/rancher-sandbox/rancher-desktop/src/go/startup-profile/model"
)

// Normalize events from a single source.  This means:
// - All begin/end pairs have a minimum delta (i.e. not zero-time).
// - All begin events have a duration set (i.e. not zero-time).
// - All instant events have a duration set (i.e. not zero-time).
// - Any events following zero-time events have been moved back.
func ProcessSource(ctx context.Context, name string, events []*model.Event) error {
	// If we have no events, don't touch anything.
	if len(events) == 0 {
		return nil
	}

	// Make sure the inputs are in chronological order.
	slices.SortStableFunc(events, func(a, b *model.Event) int {
		return a.TimeStamp.Compare(b.TimeStamp)
	})

	// For any instant events, as well as begin/end pairs of time zero, set their
	// time to one microsecond.
	minimumTime := events[0].TimeStamp
	for i, event := range events {
		if event.TimeStamp.Before(minimumTime) {
			event.TimeStamp = minimumTime
		}
		switch event.Phase {
		case model.EventPhaseBegin:
			// TODO: make this not O(n^2)
			var endEvent *model.Event
			for j := i + 1; endEvent == nil && j < len(events); j++ {
				candidate := events[j]
				if candidate.Phase != model.EventPhaseEnd {
					continue
				}
				if candidate.Category != event.Category {
					// Should not happen: this should be from the same source.
					panic(fmt.Sprintf("Unexpected category %s/%s", candidate.Category, event.Category))
				}
				if candidate.Name != event.Name {
					continue
				}
				endEvent = candidate
			}
			if endEvent == nil {
				return fmt.Errorf("failed to find end event for %+v", event)
			}
			if endEvent.TimeStamp.After(event.TimeStamp) {
				event.Duration = endEvent.TimeStamp.Sub(event.TimeStamp)
				continue
			}
			// If we get here, then this is a begin/end pair with zero time.
			event.Duration = time.Microsecond
			minimumTime = event.TimeStamp.Add(event.Duration)
		case model.EventPhaseEnd:
			endTime := event.TimeStamp.Add(time.Microsecond)
			if minimumTime.Before(endTime) {
				minimumTime = endTime
			}
		case model.EventPhaseInstant:
			event.Duration = time.Microsecond
			if event.TimeStamp.Before(minimumTime) {
				event.TimeStamp = minimumTime
			}
			minimumTime = event.TimeStamp.Add(event.Duration)
		}
	}

	if f, err := os.Create(name + ".json"); err == nil {
		encoder := json.NewEncoder(f)
		encoder.SetIndent("", "  ")
		if err := encoder.Encode(events); err != nil {
			slog.ErrorContext(ctx, "error writing debug logs", "processor", name, "error", err)
		}
	}

	return nil
}

// Process the events to normalize them.  At this point, ProcessSource must have
// been called already (but the events may be out of order).
func processEvents(events []*model.Event) error {
	// Start time is the time of the chronologically first event.
	startTime := time.Now()
	// Beginnings is a map from category then name to the event index for the "begin" event
	beginnings := make(map[string]map[string]int)
	// Endings is a map from the begin event to the end event, by event id.
	endings := make(map[int]int)

	for i, event := range events {
		if !event.TimeStamp.IsZero() && event.TimeStamp.Before(startTime) {
			startTime = event.TimeStamp
		}
		switch event.Phase {
		case model.EventPhaseBegin:
			if _, ok := beginnings[event.Category]; !ok {
				beginnings[event.Category] = make(map[string]int)
			}
			beginnings[event.Category][event.Name] = i
		case model.EventPhaseEnd:
			names, ok := beginnings[event.Category]
			if !ok {
				return fmt.Errorf("events out of order: found ending event %+v before category", event)
			}
			beginId, ok := names[event.Name]
			if !ok {
				return fmt.Errorf("events out of order: found ending event %+v before beginning", event)
			}
			endings[beginId] = i
			event.TimeStamp = events[beginId].TimeStamp.Add(events[beginId].Duration)
		}
	}

	for _, event := range events {
		if event.TimeStamp.IsZero() {
			event.TimeStamp = startTime.Add(-time.Nanosecond)
		}
	}

	// Process the events to make sure they have (offset) times
	slices.SortStableFunc(events, func(a, b *model.Event) int {
		if start := a.TimeStamp.Compare(b.TimeStamp); start != 0 {
			return start
		}
		// Compare by duration, with longer events first.
		// Do not otherwise sort them, to keep things like dmesg lines in order.
		return -cmp.Compare(a.Duration, b.Duration)
	})

	// Set the time-since-start field.
	for _, event := range events {
		event.Time = int64(event.TimeStamp.Sub(events[0].TimeStamp) / time.Microsecond)
	}

	return nil
}
