# Build and install the Snapcraft package locally

This document contains information on how to build and install Snapcraft packages locally.

## Prerequisites

Developers need to configure `kvm`, `pass`, install the C/C++ compiler toolchain, Node.js, Golang, yarn, Snapcraft,
and configure `/etc/sysctl.conf` appropriately.

For Ubuntu 24.04, a possible configuration example is as follows,

```bash
sudo apt update && sudo apt upgrade --assume-yes
sudo usermod -a -G kvm "$USER"
newgrp kvm
sudo apt install --assume-yes pass build-essential

tee /tmp/foo.txt <<EOF
Key-Type: DSA
Key-Length: 1024
Subkey-Type: ELG-E
Subkey-Length: 1024
Name-Real: Joe Tester
Name-Comment: with stupid passphrase
Name-Email: joe@foo.bar
Expire-Date: 0
Passphrase: abc
%commit
EOF

gpg --batch --generate-key /tmp/foo.txt
pass init "<joe@foo.bar>"

sudo tee --append /etc/sysctl.conf <<EOF
net.ipv4.ip_unprivileged_port_start=80
EOF

sudo sysctl --load
curl -sSL https://raw.githubusercontent.com/version-fox/vfox/main/install.sh | bash
echo 'eval "$(vfox activate bash)"' >> ~/.bashrc
source ~/.bashrc
vfox add nodejs golang
vfox install nodejs@22.22.0 golang@1.25.6
vfox use --global golang@1.25.6
vfox use --global nodejs@22.22.0
npm uninstall -g yarn pnpm
npm install -g corepack

sudo snap install snapcraft --classic
sudo snap install multipass
sudo snap set snapcraft provider=multipass
```

## Build Snapcraft Packages

For Ubuntu 24.04, a possible configuration example is as follows,

```bash
cd ./rancher-desktop/
corepack install
yarn
yarn build
yarn package
cp dist/rancher-desktop-*-linux.zip packaging/linux/rancher-desktop-linux.zip
cd ./packaging/linux/
snapcraft clean
snapcraft pack
```

## Install unsigned Snapcraft packages

For Ubuntu 24.04, a possible configuration example is as follows,

```bash
cd ./rancher-desktop/
cd ./packaging/linux/
sudo snap install --dangerous ./rancher-desktop_*.snap
sudo snap alias rancher-desktop.docker docker
sudo snap alias rancher-desktop.nerdctl nerdctl
sudo snap alias rancher-desktop.kubectl kubectl
sudo snap alias rancher-desktop.helm helm
sudo snap alias rancher-desktop.spin spin
sudo snap alias rancher-desktop.rdctl rdctl
sudo snap alias rancher-desktop.kuberlr kuberlr
sudo snap alias rancher-desktop.docker-credential-ecr-login docker-credential-ecr-login
sudo snap alias rancher-desktop.docker-credential-none docker-credential-none
sudo snap alias rancher-desktop.docker-credential-pass docker-credential-pass
sudo snap alias rancher-desktop.docker-credential-secretservice docker-credential-secretservice
```

## Run the Snapcraft package

To run the Snapcraft package, you can directly run `rancher-desktop`.

```bash
snap run rancher-desktop
```

Or use `rdctl`,

```bash
rdctl start --application.start-in-background --container-engine.name=moby --kubernetes.enabled=false
```

All Rancher Desktop command-line tools are available, for example,

```bash
docker info
docker run hello-world
```
