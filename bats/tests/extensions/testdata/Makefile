all: \
  image-basic image-missing-icon image-ui \
  image-vm-image image-vm-compose image-host-binaries image-host-apis

TOOL ?= docker

NAMESPACE = $(if $(filter %nerdctl,${TOOL}),--namespace=rancher-desktop-extensions)

image-%:
	${TOOL} ${NAMESPACE} build -t rd/extension/$(@:image-%=%) --build-arg variant=$(@:image-%=%) .
