########################################################################
: "${RD_CONTAINER_ENGINE:=containerd}"

validate_enum RD_CONTAINER_ENGINE containerd moby

using_containerd() {
    test "$RD_CONTAINER_ENGINE" = "containerd"
}

using_docker() {
    ! using_containerd
}

########################################################################
: "${RD_RANCHER_IMAGE_TAG:=}"

rancher_image_tag() {
    echo "${RANCHER_IMAGE_TAG:-v2.7.0}"
}

########################################################################
# Defaults to true, except in the helper unit tests, which default to false
: "${RD_INFO:=}"

########################################################################
: "${RD_CAPTURE_LOGS:=false}"

capturing_logs() {
    is_true "$RD_CAPTURE_LOGS"
}

########################################################################
: "${RD_NO_MODAL_DIALOGS:=true}"

suppressing_modal_dialogs() {
    is_true "$RD_NO_MODAL_DIALOGS"
}

########################################################################
: "${RD_TAKE_SCREENSHOTS:=false}"

taking_screenshots() {
    is_true "$RD_TAKE_SCREENSHOTS"
}

########################################################################
: "${RD_TRACE:=false}"

########################################################################
# When RD_USE_GHCR_IMAGES is true, then all images will be pulled from
# ghcr.io instead of docker.io, to avoid hitting the docker hub pull
# rate limit.

: "${RD_USE_GHCR_IMAGES:=false}"

using_ghcr_images() {
    is_true "$RD_USE_GHCR_IMAGES"
}

########################################################################
: "${RD_DELETE_PROFILES:=true}"

deleting_profiles() {
    is_true "$RD_DELETE_PROFILES"
}

########################################################################
: "${RD_USE_IMAGE_ALLOW_LIST:=false}"

using_image_allow_list() {
    is_true "$RD_USE_IMAGE_ALLOW_LIST"
}

########################################################################
# RD_USE_PROFILE is for internal use. It uses a profile instead of
# settings.json to set initial values for WSL integrations and allowed
# images list because when settings.json exists the default profile is
# ignored.

: "${RD_USE_PROFILE:=false}"

########################################################################
# RD_TIMEOUT is for internal use. It is used to configure timeouts for
# the `rdctl` command, and should not be set outside of specific
# commands.
: "${RD_TIMEOUT:=}"

if [[ -n $RD_TIMEOUT ]]; then
    fatal "RD_TIMEOUT should not be set"
fi

########################################################################
: "${RD_USE_VZ_EMULATION:=false}"

using_vz_emulation() {
    is_true "$RD_USE_VZ_EMULATION"
}

if using_vz_emulation && ! supports_vz_emulation; then
    fatal "RD_USE_VZ_EMULATION is not supported on this OS or OS version"
fi

########################################################################
: "${RD_USE_WINDOWS_EXE:=false}"

using_windows_exe() {
    is_true "$RD_USE_WINDOWS_EXE"
}

if using_windows_exe && ! is_windows; then
    fatal "RD_USE_WINDOWS_EXE only works on Windows"
fi

########################################################################
if is_unix; then
    : "${RD_MOUNT_TYPE:=reverse-sshfs}"

    validate_enum RD_MOUNT_TYPE reverse-sshfs 9p virtiofs

    if [ "$RD_MOUNT_TYPE" = "virtiofs" ] && ! using_vz_emulation; then
        fatal "RD_MOUNT_TYPE=virtiofs only works with VZ emulation"
    fi
    if [ "$RD_MOUNT_TYPE" = "9p" ] && using_vz_emulation; then
        fatal "RD_MOUNT_TYPE=9p only works with qemu emulation"
    fi
else
    : "${RD_MOUNT_TYPE:=}"
    if [ -n "${RD_MOUNT_TYPE:-}" ]; then
        fatal "RD_MOUNT_TYPE only works on Linux and macOS"
    fi
fi

########################################################################
: "${RD_9P_CACHE_MODE:=mmap}"

validate_enum RD_9P_CACHE_MODE none loose fscache mmap

########################################################################
: "${RD_9P_MSIZE:=128}"

########################################################################
: "${RD_9P_PROTOCOL_VERSION:=9p2000.L}"

validate_enum RD_9P_PROTOCOL_VERSION 9p2000 9p2000.u 9p2000.L

########################################################################
: "${RD_9P_SECURITY_MODEL:=none}"

validate_enum RD_9P_SECURITY_MODEL passthrough mapped-xattr mapped-file none

########################################################################
# When RD_USE_RAMDISK is true, we will try to set up a temporary ramdisk
# for the application profile to make things run faster.  This is not
# supported on all platforms, but is a no-op on unsupported platforms.
# Some test files may override this due to interactions with factory reset.
: "${RD_USE_RAMDISK:=false}"
# Size of the ramdisk, in gigabytes.  If a test requires more space than given,
# then ramdisk will be disabled for that test.
: "${RD_RAMDISK_SIZE:=12}"
using_ramdisk() {
    is_true "${RD_USE_RAMDISK}"
}

########################################################################
# Use RD_PROTECTED_DOT in profile settings for WSL distro names.
: "${RD_PROTECTED_DOT:=·}"

########################################################################
# RD_KUBELET_TIMEOUT specifies the number of minutes wait_for_kubelet()
# waits before it times out.
: "${RD_KUBELET_TIMEOUT:=10}"

########################################################################
# RD_LOCATION specifies the location where Rancher Desktop is installed
#   system: default system-wide install location shared for all users
#   user:   per-user install location
#   dist:   use the result of `yarn package` in ../dist
#   dev:    dev mode; start app with `cd ..; yarn dev`
#   "":     use first location from the list above that contains the app

: "${RD_LOCATION:=}"

validate_enum RD_LOCATION system user dist dev ""

using_dev_mode() {
    [ "$RD_LOCATION" = "dev" ]
}

########################################################################
# Kubernetes versions

# The main Kubernetes version to test.
: "${RD_KUBERNETES_VERSION:=1.32.7}"

# A secondary Kubernetes version; this is used for testing upgrades.
: "${RD_KUBERNETES_ALT_VERSION:=1.31.3}"

# RD_K3S_VERSIONS specifies a list of k3s versions. foreach_k3s_version()
# can dynamically register a test to run once for each version in the
# list. Only versions between RD_K3S_MIN and RD_K3S_MAX (inclusively)
# will be used.
#
# Special values:
# "all" will fetch the list of all k3s releases from GitHub
# "latest" will fetch the list of latest versions from the release channel

: "${RD_K3S_MIN:=1.25.3}"
: "${RD_K3S_MAX:=1.99.0}"
: "${RD_K3S_VERSIONS:=$RD_KUBERNETES_VERSION}"

validate_semver RD_K3S_MIN
validate_semver RD_K3S_MAX

# Cache expansion of RD_K3S_VERSIONS special versions because they are slow to compute
if ! load_var RD_K3S_VERSIONS; then
    # Fetch "all" or "latest" versions
    get_k3s_versions

    for k3s_version in ${RD_K3S_VERSIONS}; do
        validate_semver k3s_version
    done

    save_var RD_K3S_VERSIONS
fi

########################################################################
# RD_VPN_TEST_IMAGE specifies the URL used by the split DNS test to access
# the private registry. Defaults to empty. Can be set via environment
# variable when running tests.

: "${RD_VPN_TEST_IMAGE:=}"

using_vpn_test_image() {
    [[ -n $RD_VPN_TEST_IMAGE ]]
}
