# These images have been mirrored to ghcr.io (using bats/scripts/ghcr-mirror.sh)
# to avoid hitting Docker Hub pull limits during testing.

# TODO TODO TODO
# The python image is huge (10GB across all platforms). We should either pin the
# tag, or replace it with a different image for testing, so we don't have to mirror
# the images to ghcr.io every time we run the mirror script.
# TODO TODO TODO

# Any time you add an image here you need to re-run the mirror script!
IMAGES=(busybox nginx python ruby tonistiigi/binfmt registry:2.8.1)

GHCR_REPO=ghcr.io/rancher-sandbox/bats

# Create IMAGE_FOO_BAR=foo/bar:tag variables
for IMAGE in "${IMAGES[@]}"; do
    VAR="IMAGE_$(echo "$IMAGE" | sed 's/:.*//' | tr '[:lower:]' '[:upper:]' | tr / _)"
    # file may be loaded outside BATS environment
    if [ "$(type -t using_ghcr_images)" = "function" ] && using_ghcr_images; then
        eval "$VAR=$GHCR_REPO/$IMAGE"
    else
        eval "$VAR=$IMAGE"
    fi
done
