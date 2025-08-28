package model

import "time"

type EventPhase string

const (
	EventPhaseBegin   = EventPhase("B")
	EventPhaseEnd     = EventPhase("E")
	EventPhaseInstant = EventPhase("i")
)

// Event describes something happening.  It is in Google's Trace Event Format,
// as described in https://docs.google.com/document/d/1CvAClvFfyA5R-PhYUmn5OOQtYMH4h6I0nSsKchNAySU/preview?tab=t.0#heading=h.uxpopqvbjezh
type Event struct {
	Name     string     `json:"name"`
	Category string     `json:"cat"`
	Phase    EventPhase `json:"ph"`
	// Each event must have a timestamp; the `time` field is generated when rendering.
	TimeStamp time.Time      `json:"-time-stamp"`
	PID       int            `json:"pid"`
	TID       int            `json:"tid"`
	Args      map[string]any `json:"args"`

	// Event time in microseconds since start of trace; generated when rendering.
	Time int64 `json:"ts"`
	// Duration of "begin" events; generated when rendering.
	Duration time.Duration `json:"-duration"`
}
