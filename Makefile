LDFLAGS = -ldflags '-s -w'

.PHONY: build
build: host-switch vm-switch

bin/host-switch.exe:
	GOOS=windows go build $(LDFLAGS) -o $@ ./cmd/host

.PHONY: host-switch
host-switch: bin/host-switch.exe

bin/vm-switch:
	GOOS=linux go build $(LDFLAGS) -o $@ ./cmd/vm

.PHONY: vm-switch
vm-switch: bin/vm-switch

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
