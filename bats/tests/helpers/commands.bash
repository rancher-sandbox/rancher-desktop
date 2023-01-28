exe=""
if [ -n "${RD_USE_WINDOWS_EXE:-}" ]; then
   exe=".exe"
fi

if using_containerd; then
    CONTAINER_ENGINE_SERVICE=containerd
else
    CONTAINER_ENGINE_SERVICE=docker
fi

if is_unix; then
    RC_SERVICE=rc-service
elif is_windows; then
    RC_SERVICE=wsl-service
fi

if is_macos; then
    CRED_HELPER="docker-credential-osxkeychain"
elif is_linux; then
    CRED_HELPER="docker-credential-pass"
fi

ctrctl() {
    if using_docker; then
        docker "$@"
    else
        nerdctl "$@"
    fi
}
docker() {
    docker_exe --context rancher-desktop "$@"
}
docker_exe() {
    "$PATH_RESOURCES/bin/docker$exe" "$@"
}
helm() {
    "$PATH_RESOURCES/bin/helm$exe" "$@"
}
kubectl() {
    kubectl_exe --context rancher-desktop "$@"
}
kubectl_exe() {
    "$PATH_RESOURCES/bin/kubectl$exe" "$@"
}
limactl() {
    LIMA_HOME="$LIMA_HOME" "$PATH_RESOURCES/lima/bin/limactl" "$@"
}
nerdctl() {
    "$PATH_RESOURCES/bin/nerdctl$exe" "$@"
}
rdctl() {
    "$PATH_RESOURCES/bin/rdctl$exe" "$@"
}
rdshell() {
    rdctl shell "$@"
}
rdsudo() {
    rdshell sudo "$@"
}
