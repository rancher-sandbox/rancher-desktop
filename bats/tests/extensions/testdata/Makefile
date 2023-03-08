all: \
  image-basic image-missing-icon image-ui \
  image-vm-image image-vm-compose image-host-binaries

image-%:
	docker build -t rd/extension/$(@:image-%=%) --build-arg variant=$(@:image-%=%) .
