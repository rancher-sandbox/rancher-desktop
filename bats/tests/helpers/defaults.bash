validate_enum() {
    local var=$1
    shift
    for value in "$@"; do
        if [ "${!var}" = "$value" ]; then
            return
        fi
    done
    fatal "$var=${!var} is not a valid setting; select from [$*]"
}

: "${RD_CONTAINER_ENGINE:=containerd}"
validate_enum RD_CONTAINER_ENGINE containerd moby

: "${RD_KUBERNETES_VERSION:=1.23.6}"
: "${RD_KUBERNETES_PREV_VERSION:=1.22.7}"
: "${RD_RANCHER_IMAGE_TAG:=v2.7.0}"

: "${RD_USE_IMAGE_ALLOW_LIST:=false}"
: "${RD_USE_WINDOWS_EXE:=false}"

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

using_image_allow_list() {
    is_true "$RD_USE_IMAGE_ALLOW_LIST"
}

using_windows_exe() {
    is_true "$RD_USE_WINDOWS_EXE"
}
