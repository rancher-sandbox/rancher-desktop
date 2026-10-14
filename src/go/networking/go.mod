module github.com/rancher-sandbox/rancher-desktop/src/go/networking

go 1.26.6

require (
	github.com/Microsoft/go-winio v0.6.3
	github.com/containers/gvisor-tap-vsock v0.9.0
	github.com/coreos/go-systemd/v22 v22.7.0
	github.com/dustin/go-humanize v1.1.0
	github.com/google/gopacket v1.1.19
	github.com/linuxkit/virtsock v0.0.0-20241009230534-cb6a20cc0422
	github.com/rancher-sandbox/rancher-desktop/src/go/ports v0.0.0-00010101000000-000000000000
	github.com/sirupsen/logrus v1.10.2
	github.com/songgao/packets v0.0.0-20160404182456-549a10cd4091
	github.com/songgao/water v0.0.0-20200317203138-2b4b6d7c09d8
	github.com/stretchr/testify v1.12.1
	github.com/vishvananda/netlink v1.3.1
	github.com/vishvananda/netns v0.0.5
	golang.org/x/net v0.61.0
	golang.org/x/sync v0.24.0
	golang.org/x/sys v0.49.0
	gvisor.dev/gvisor v0.0.0-20260413194555-9680d69bf798
)

require (
	github.com/godbus/dbus/v5 v5.1.0 // indirect
	github.com/google/btree v1.1.3 // indirect
	github.com/inetaf/tcpproxy v0.0.0-20260515195445-c159a6051109 // indirect
	github.com/insomniacslk/dhcp v0.0.0-20240829085014-a3a4c1f04475 // indirect
	github.com/mdlayher/socket v0.6.0 // indirect
	github.com/mdlayher/vsock v1.3.0 // indirect
	github.com/miekg/dns v1.1.73 // indirect
	github.com/pierrec/lz4/v4 v4.1.21 // indirect
	github.com/u-root/uio v0.0.0-20240224005618-d2acac8f3701 // indirect
	go.yaml.in/yaml/v3 v3.0.5 // indirect
	golang.org/x/crypto v0.58.0 // indirect
	golang.org/x/exp v0.0.0-20241108190413-2d47ceb2692f // indirect
	golang.org/x/mod v0.42.0 // indirect
	golang.org/x/time v0.16.0 // indirect
	golang.org/x/tools v0.51.0 // indirect
)

// Dependabot does not read go.work, so without this it pins a remote version.
replace github.com/rancher-sandbox/rancher-desktop/src/go/ports => ../ports
