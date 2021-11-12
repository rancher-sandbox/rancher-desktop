#!/bin/bash

# Get the tag in the two forms it's needed.
withV=${GITHUB_REF#"refs/tags/"}
withoutV=${GITHUB_REF#"refs/tags/v"}

mkdir dist

cd dist && curl -L -O https://github.com/rancher-sandbox/rancher-desktop/releases/download/${withV}/rancher-desktop-${withoutV}-linux.zip
