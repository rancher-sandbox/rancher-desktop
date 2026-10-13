// This module must stay free of requirements, test-only ones included.
// networking and guestagent both require it, so its requirements join
// their module graphs, and a version above theirs fails their builds with
// "updates to go.mod needed". So does a go line above theirs.
module github.com/rancher-sandbox/rancher-desktop/src/go/ports

go 1.26.0
