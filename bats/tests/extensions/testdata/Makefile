all: \
  image-basic image-missing-icon image-ui \
  image-vm-image image-vm-compose image-host-binaries

TOOL ?= docker

image-%:
	${TOOL} build -t rd/extension/$(@:image-%=%) --build-arg variant=$(@:image-%=%) .
