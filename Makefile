LDFLAGS = -ldflags '-s -w'

.PHONY: build
build: host-switch

.PHONY: host-switch
host-switch:
			GOOS=windows go build $(LDFLAGS) -o bin/host-switch.exe ./cmd/host

.PHONY: clean
clean:
	rm -rf ./bin

.PHONY: vendor
vendor:
	go mod tidy
	go mod vendor