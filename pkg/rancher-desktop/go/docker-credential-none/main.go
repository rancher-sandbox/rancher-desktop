package main

import (
	"github.com/docker/docker-credential-helpers/credentials"
	"github.com/rancher-sandbox/rancher-desktop/pkg/rancher-desktop/go/docker-credential-none/dcnone"
)

func main() {
	credentials.Serve(dcnone.DCNone{})
}
