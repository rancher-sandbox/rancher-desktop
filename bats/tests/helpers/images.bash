# These images have been mirrored to ghcr.io (using bats/scripts/ghcr-mirror.sh)
# to avoid hitting Docker Hub pull limits during testing.

# TODO TODO TODO
# The python image is huge (10GB across all platforms). We should either pin the
# tag, or replace it with a different image for testing, so we don't have to mirror
# the images to ghcr.io every time we run the mirror script.
# TODO TODO TODO

# Any time you add an image here you need to re-run the mirror script!
IMAGES=(alpine busybox nginx python python:3.9-slim ruby tonistiigi/binfmt registry:2.8.1)

GHCR_REPO=ghcr.io/rancher-sandbox/bats

# Create IMAGE_FOO_BAR_TAG=foo/bar:tag variables
for IMAGE in "${IMAGES[@]}"; do
    VAR="IMAGE_$(echo "$IMAGE" | tr '[:lower:]' '[:upper:]' | tr -C '[:alnum:][:space:]' _)"
    # file may be loaded outside BATS environment
    if [ "$(type -t using_ghcr_images)" = "function" ] && using_ghcr_images; then
        eval "$VAR=$GHCR_REPO/$IMAGE"
    else
        eval "$VAR=$IMAGE"
    fi
done

# shellcheck disable=2034 # The registry image doesn't really need the tag
IMAGE_REGISTRY=$IMAGE_REGISTRY_2_8_1
