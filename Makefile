.PHONY: build
build:
	GOOS=linux CGO_ENABLED=false go build -ldflags=-w -o=./dist/rancher-desktop-guestagent ./cmd/rancher-desktop-guestagent/