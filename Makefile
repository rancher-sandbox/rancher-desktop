LDFLAGS = -ldflags '-s -w'

.PHONY: build
build: host-switch vm-switch network-setup wsl-proxy

bin/host-switch.exe:
	GOOS=windows go build $(LDFLAGS) -o $@ ./cmd/host

.PHONY: host-switch
host-switch: bin/host-switch.exe

bin/vm-switch:
	GOOS=linux go build $(LDFLAGS) -o $@ ./cmd/vm

.PHONY: vm-switch
vm-switch: bin/vm-switch

bin/network-setup:
	GOOS=linux go build $(LDFLAGS) -o $@ ./cmd/network

.PHONY: network-setup
network-setup: bin/network-setup

bin/wsl-proxy:
	GOOS=linux go build $(LDFLAGS) -o $@ ./cmd/proxy

.PHONY: wsl-proxy
wsl-proxy: bin/wsl-proxy

.PHONY: fmt
fmt:
	gofmt -l -s -w .

.PHONY: clean
clean:
	rm -rf ./bin

.PHONY: vendor
vendor:
	go mod tidy
	go mod vendor
