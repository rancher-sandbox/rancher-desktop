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
: "${RD_KUBERNETES_VERSION:=1.23.6}"

########################################################################
: "${RD_KUBERNETES_PREV_VERSION:=1.22.7}"

########################################################################
: "${RD_RANCHER_IMAGE_TAG:=v2.7.0}"

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
: "${RD_USE_IMAGE_ALLOW_LIST:=false}"

using_image_allow_list() {
    is_true "$RD_USE_IMAGE_ALLOW_LIST"
}

########################################################################
: "${RD_USE_VZ_EMULATION:=false}"

using_vz_emulation() {
    is_true "$RD_USE_VZ_EMULATION"
}

if using_vz_emulation && ! is_macos; then
    fatal "RD_USE_VZ_EMULATION only works on macOS"
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
: "${RD_USE_NETWORKING_TUNNEL:=false}"

using_networking_tunnel() {
    is_true "$RD_USE_NETWORKING_TUNNEL"
}

if using_networking_tunnel && ! is_windows; then
    fatal "RD_USE_NETWORKING_TUNNEL only works on Windows"
fi

########################################################################
if ! is_unix && [ -n "${RD_MOUNT_TYPE-}" ]; then
    fatal "RD_MOUNT_TYPE only works on Linux and macOS"
fi

: "${RD_MOUNT_TYPE:=reverse-sshfs}"

validate_enum RD_MOUNT_TYPE reverse-sshfs 9p virtiofs

if [ "$RD_MOUNT_TYPE" = "virtiofs" ] && ! using_vz_emulation; then
    fatal "RD_MOUNT_TYPE=virtiofs only works with VZ emulation"
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
# RD_LOCATION specifies the location where Rancher Desktop is installed
#   system: default system-wide install location shared for all users
#   user:   per-user install location
#   dist:   use the result of `npm run package` in ../dist
#   npm:    dev mode; start app with `cd ..; npm run dev`
#   "":     use first location from the list above that contains the app

: "${RD_LOCATION:=}"

validate_enum RD_LOCATION system user dist npm ""

using_npm_run_dev() {
    [ "$RD_LOCATION" = "npm" ]
}
