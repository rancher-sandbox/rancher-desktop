package info

import (
	"context"

	"github.com/rancher-sandbox/rancher-desktop/src/go/rdctl/pkg/client"
	"github.com/rancher-sandbox/rancher-desktop/src/go/rdctl/pkg/version"
)

func getVersion(ctx context.Context, result *Info, _ client.RDClient) error {
	result.Version = version.Version
	return nil
}

func init() {
	register("version", getVersion)
}
