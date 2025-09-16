package info

import (
	"context"

	"github.com/rancher-sandbox/rancher-desktop/src/go/rdctl/pkg/client"
)

// An Info describes the output the user will receive when running `rdctl info`
// with no special options.
type Info struct {
	Version string `json:"version" help:"Rancher Desktop application version"`
}

// HandlerFunc is the generic interface to populate the [Info] result structure.
// The function is expected to fill in the fields it knows.
// The given client may be `nil` if the configuration is invalid.
type HandlerFunc func(context.Context, *Info, client.RDClient) error

// Handlers that have been registered; the key should be the same as the JSON
// field tag (on struct [Info]).
var Handlers map[string]HandlerFunc

// Register a handler for a given field.
func register(name string, handler HandlerFunc) {
	if Handlers == nil {
		Handlers = make(map[string]HandlerFunc)
	}
	Handlers[name] = handler
}
