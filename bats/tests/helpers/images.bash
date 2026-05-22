# These images have been mirrored to ghcr.io (using bats/scripts/ghcr-mirror.sh)
# to avoid hitting Docker Hub pull limits during testing.

# Any time you add an image here you need to re-run the mirror script!
IMAGES=(alpine busybox nginx python:3.12-alpine ruby tonistiigi/binfmt registry:2.8.1)

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

# shellcheck disable=2034 # Short aliases for versioned image variables
IMAGE_PYTHON=$IMAGE_PYTHON_3_12_ALPINE
IMAGE_REGISTRY=$IMAGE_REGISTRY_2_8_1
