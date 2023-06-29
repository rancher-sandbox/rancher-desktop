#!/bin/bash

# Mirror Docker Hub images to ghcr.io to avoid pull limits during testing.

# The script uses skopeo instead of docker pull/push because it needs to
# copy all images of the repo, and not just the one for the current platform.
#
# Log into ghcr.io with a personal access token with write:packages scope:
#   echo $PAT | skopeo login ghcr.io -u $USER --password-stdin
#   echo $PASS | skopeo login docker.io -u $USER --password-stdin
# Remove credentials:
#   skopeo logout --all

# TODO TODO TODO
# The package visibility needs to be changed to "public".
# I've not found any tool/API to do this from the commandline,
# so I did this manually via the web UI.
# At the very least we should check that the images are accessible
# when logged out of ghcr.io.
# TODO TODO TODO

# TODO TODO TODO
# Figure out a way to copy only the amd64 and arm64 images, but not the rest.
# skopeo doesn't seem to support this yet without additional scripting to parse
# the manifests. And then we would need to test if we can copy a "sparse" manifest
# to ghcr.io when not all referenced images actually exist.
# TODO TODO TODO

set -o errexit -o nounset -o pipefail
set +o xtrace

if ! command -v skopeo >/dev/null; then
    echo "This script requires the 'skopeo' utility to be installed"
    exit 1
fi

source "$(dirname "${BASH_SOURCE[0]}")/../tests/helpers/images.bash"

# IMAGES is setup by ../tests/helpers/images.bash
# shellcheck disable=SC2153
for IMAGE in "${IMAGES[@]}"; do
    echo "===== Copying $IMAGE ====="
    skopeo copy --all "docker://$IMAGE" "docker://$GHCR_REPO/$IMAGE"
done
