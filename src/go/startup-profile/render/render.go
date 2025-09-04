package render

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"os"
	"slices"

	"github.com/rancher-sandbox/rancher-desktop/src/go/startup-profile/model"
)

// Render the events into a data structure suitable to be JSON-encoded into a
// file as a Chrome CPU profile.
func Render(ctx context.Context, events []*model.Event) (any, error) {
	// Insert a fake root event at the start
	events = append([]*model.Event{
		{
			Name:     "(root)",
			Category: "root",
			Phase:    model.EventPhaseBegin,
			Time:     0,
		},
	}, events...)

	if err := processEvents(events); err != nil {
		return nil, err
	}

	profile := profile{
		StartTime: events[0].TimeStamp.UnixMicro(),
		EndTime:   events[len(events)-1].TimeStamp.UnixMicro(),
	}

	events[0].Duration = events[len(events)-1].TimeStamp.Sub(events[0].TimeStamp)

	// Insert the end of the fake root event at the end
	events = append(events, &model.Event{
		Name:     "(root)",
		Category: "root",
		Phase:    model.EventPhaseEnd,
		Time:     profile.EndTime - profile.StartTime,
	})

	if f, err := os.Create("processed.json"); err == nil {
		encoder := json.NewEncoder(f)
		encoder.SetIndent("", "  ")
		if err := encoder.Encode(events); err != nil {
			slog.ErrorContext(ctx, "error writing debug logs", "error", err)
		}
	}

	var stack []*profileNode
	var lastTime int64
	nextId := nodeId(1)
	for i, event := range events {
		switch event.Phase {
		case model.EventPhaseBegin:
			if i >= len(events)-1 {
				// This is the last event; but it's a begin phase
				return nil, fmt.Errorf("invalid event stream: last event is in phase begin: %+v", event)
			}
			node := profileNode{
				Id: nextId,
				CallFrame: callFrame{
					FunctionName: event.Name,
					ScriptId:     event.Category,
					Url:          event.Category,
					LineNumber:   -1,
					ColumnNumber: -1,
				},
				StartTime: event.TimeStamp,
				StopTime:  event.TimeStamp.Add(event.Duration),
				Duration:  event.Duration,
			}
			profile.Nodes = append(profile.Nodes, &node)
			nextId++
			if len(stack) > 0 {
				stack[len(stack)-1].Children = append(stack[len(stack)-1].Children, node.Id)
			}
			stack = append(stack, &node)
			nextEvent := events[i+1]
			if event.Time < nextEvent.Time {
				// The next event is at a different time; insert this node.
				profile.Samples = append(profile.Samples, node.Id)
				profile.TimeDeltas = append(profile.TimeDeltas, max(event.Time-lastTime, 1))
				lastTime = event.Time
			}
		case model.EventPhaseEnd:
			if i < 1 {
				return nil, fmt.Errorf("invalid event stream: first event is in phase end: %+v", event)
			}
			if len(stack) < 1 {
				return nil, fmt.Errorf("invalid event stream: ending with empty stack: %+v", event)
			}
			for j := len(stack) - 1; j >= 0; j-- {
				if stack[j].CallFrame.FunctionName != event.Name {
					continue
				}
				if stack[j].CallFrame.ScriptId != event.Category {
					continue
				}
				// We need to remove this item from the stack; however, logically this
				// means we need to recreate any nodes on top (with new IDs) because
				// the profile is supposed to have matching stacks.
				for k := j; k < len(stack)-1; k++ {
					node := profileNode{
						Id:        nextId,
						CallFrame: stack[k+1].CallFrame,
						Children:  slices.Clone(stack[k+1].Children),
						StartTime: event.TimeStamp,
						StopTime:  event.TimeStamp.Add(event.Duration),
						Duration:  event.Duration,
					}
					stack[k] = &node
					profile.Nodes = append(profile.Nodes, &node)
					nextId++
					if k > 0 {
						stack[k-1].Children = append(stack[k-1].Children, node.Id)
					}
				}
				stack = stack[:len(stack)-1]
				break
			}
			emitSample := len(stack) > 0
			if len(events)-1 > i {
				// There are more events; check if the next event has a time change
				nextEvent := events[i+1]
				emitSample = emitSample && event.Time != nextEvent.Time
			}
			if emitSample {
				// The next event is at a different time; insert this node.
				profile.Samples = append(profile.Samples, stack[len(stack)-1].Id)
				profile.TimeDeltas = append(profile.TimeDeltas, max(event.Time-lastTime, 1))
				lastTime = event.Time
			}
		case model.EventPhaseInstant:
			if i < 1 {
				return nil, fmt.Errorf("invalid event stream: first event is instant: %+v", event)
			}
			if len(stack) < 1 {
				return nil, fmt.Errorf("invalid event stream: instant event with no stack: %+v", event)
			}
			node := profileNode{
				Id: nextId,
				CallFrame: callFrame{
					FunctionName: event.Name,
					ScriptId:     event.Category,
					Url:          event.Category,
					LineNumber:   -1,
					ColumnNumber: -1,
				},
				StartTime: event.TimeStamp,
				StopTime:  event.TimeStamp.Add(event.Duration),
				Duration:  event.Duration,
			}
			nextId++
			stackTop := stack[len(stack)-1]
			// Always emit instant events directly, even if no time has passed
			stackTop.Children = append(stackTop.Children, node.Id)
			profile.Nodes = append(profile.Nodes, &node)
			profile.Samples = append(profile.Samples, node.Id)
			profile.TimeDeltas = append(profile.TimeDeltas, max(event.Time-lastTime, 0))
			lastTime = event.Time
			// If there isn't another event at the same time, "sample" the parent again
			if events[i+1].Time > event.Time {
				profile.Samples = append(profile.Samples, stackTop.Id)
				profile.TimeDeltas = append(profile.TimeDeltas, 0)
			}
		default:
			return nil, fmt.Errorf("invalid event stream: unknown phase: %+v", event)
		}
	}

	return profile, nil
}
