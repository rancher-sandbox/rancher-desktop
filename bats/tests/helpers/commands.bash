EXE=""
PLATFORM=$OS
if is_windows; then
    PLATFORM=linux
    if [ -n "${RD_USE_WINDOWS_EXE:-}" ]; then
        exe=".exe"
        platform=win32
    fi
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

if is_windows; then
    RD_DOCKER_CONTEXT=default
else
    RD_DOCKER_CONTEXT=rancher-desktop
fi

ctrctl() {
    if using_docker; then
        docker "$@"
    else
        nerdctl "$@"
    fi
}
docker() {
    docker_exe --context $RD_DOCKER_CONTEXT "$@"
}
docker_exe() {
    "$PATH_RESOURCES/$PLATFORM/bin/docker$EXE" "$@"
}
helm() {
    "$PATH_RESOURCES/$PLATFORM/bin/helm$EXE" "$@"
}
kubectl() {
    kubectl_exe --context rancher-desktop "$@"
}
kubectl_exe() {
    "$PATH_RESOURCES/$PLATFORM/bin/kubectl$EXE" "$@"
}
limactl() {
    LIMA_HOME="$LIMA_HOME" "$PATH_RESOURCES/$PLATFORM/lima/bin/limactl" "$@"
}
nerdctl() {
    "$PATH_RESOURCES/$PLATFORM/bin/nerdctl$EXE" "$@"
}
rdctl() {
    if is_windows; then
        "$PATH_RESOURCES/win32/bin/rdctl.exe" "$@"
    else
        "$PATH_RESOURCES/$PLATFORM/bin/rdctl$EXE" "$@"
    fi
}
rdshell() {
    rdctl shell "$@"
}
rdsudo() {
    rdshell sudo "$@"
}
