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

replace k8s.io/api => k8s.io/api v0.25.0

replace k8s.io/apiextensions-apiserver => k8s.io/apiextensions-apiserver v0.25.0

replace k8s.io/apimachinery => k8s.io/apimachinery v0.26.0-alpha.0

replace k8s.io/apiserver => k8s.io/apiserver v0.25.0

replace k8s.io/cli-runtime => k8s.io/cli-runtime v0.25.0

replace k8s.io/client-go => k8s.io/client-go v0.25.0

replace k8s.io/cloud-provider => k8s.io/cloud-provider v0.25.0

replace k8s.io/cluster-bootstrap => k8s.io/cluster-bootstrap v0.25.0

replace k8s.io/code-generator => k8s.io/code-generator v0.25.1-rc.0

replace k8s.io/component-base => k8s.io/component-base v0.25.0

replace k8s.io/component-helpers => k8s.io/component-helpers v0.25.0

replace k8s.io/controller-manager => k8s.io/controller-manager v0.25.0

replace k8s.io/cri-api => k8s.io/cri-api v0.25.1-rc.0

replace k8s.io/csi-translation-lib => k8s.io/csi-translation-lib v0.25.0

replace k8s.io/kube-aggregator => k8s.io/kube-aggregator v0.25.0

replace k8s.io/kube-controller-manager => k8s.io/kube-controller-manager v0.25.0

replace k8s.io/kube-proxy => k8s.io/kube-proxy v0.25.0

replace k8s.io/kube-scheduler => k8s.io/kube-scheduler v0.25.0

replace k8s.io/kubectl => k8s.io/kubectl v0.25.0

replace k8s.io/kubelet => k8s.io/kubelet v0.25.0

replace k8s.io/legacy-cloud-providers => k8s.io/legacy-cloud-providers v0.25.0

replace k8s.io/metrics => k8s.io/metrics v0.25.0

replace k8s.io/mount-utils => k8s.io/mount-utils v0.25.3-rc.0

replace k8s.io/pod-security-admission => k8s.io/pod-security-admission v0.25.0

replace k8s.io/sample-apiserver => k8s.io/sample-apiserver v0.25.0

replace k8s.io/sample-cli-plugin => k8s.io/sample-cli-plugin v0.25.0

replace k8s.io/sample-controller => k8s.io/sample-controller v0.25.0
