module github.com/rancher-sandbox/rancher-desktop/src/go/privileged-service

go 1.18

require (
	github.com/pkg/errors v0.9.1
	github.com/rancher-sandbox/rancher-desktop-agent v0.2.1-0.20220914185110-0a48c21fc77b
	github.com/spf13/cobra v1.5.0
	golang.org/x/sys v0.0.0-20220818161305-2296e01440c6
	k8s.io/utils v0.0.0-20220728103510-ee6ede2d64ed
)

require (
	github.com/go-logr/logr v1.2.3 // indirect
	k8s.io/klog/v2 v2.70.1 // indirect
)

require (
	github.com/Microsoft/go-winio v0.5.2
	github.com/docker/go-connections v0.4.0 // indirect
	github.com/inconshreveable/mousetrap v1.0.0 // indirect
	github.com/spf13/pflag v1.0.5 // indirect
	k8s.io/kubernetes v1.25.0
)
