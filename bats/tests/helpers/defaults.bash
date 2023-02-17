: "${RD_CONTAINER_ENGINE:=containerd}"
: "${RD_KUBERNETES_VERSION:=1.23.6}"
: "${RD_KUBERNETES_PREV_VERSION:=1.22.7}"
: "${RD_RANCHER_IMAGE_TAG:=v2.7.0}"

: "${RD_USE_IMAGE_ALLOW_LIST:=false}"
: "${RD_USE_WINDOWS_EXE:=false}"

using_image_allow_list() {
    is_true "$RD_USE_IMAGE_ALLOW_LIST"
}
using_windows_exe() {
    is_true "$RD_USE_WINDOWS_EXE"
}
