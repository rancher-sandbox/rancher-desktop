.PHONY: build
build:
	GOOS=linux CGO_ENABLED=0 go build -ldflags=-w -o=./dist/rancher-desktop-guestagent ./cmd/rancher-desktop-guestagent/

.PHONY: test
test:
	go test -v ./pkg/...

.PHONY: clean
clean:
	rm -rf ./dist

.PHONY: fmt
fmt:
	gofmt -l -s -w .

.PHONY: lint
lint:
	golangci-lint run
