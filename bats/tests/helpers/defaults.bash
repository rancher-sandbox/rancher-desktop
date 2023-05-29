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
: "${RD_USE_IMAGE_ALLOW_LIST:=false}"

using_image_allow_list() {
    is_true "$RD_USE_IMAGE_ALLOW_LIST"
}

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
