.PHONY: build
build:
	GOOS=linux CGO_ENABLED=0 go build -ldflags=-w -o=./dist/rancher-desktop-guestagent ./cmd/rancher-desktop-guestagent/