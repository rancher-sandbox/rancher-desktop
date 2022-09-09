exe=""
if [ -n "$RD_USE_WINDOWS_EXE" ]; then
   exe=".exe"
fi

HELM="helm$exe"
KUBECTL="kubectl$exe --context rancher-desktop"
RDCTL="rdctl$exe"
DOCKER="docker$exe --context rancher-desktop"
NERDCTL="nerdctl$exe"

if [ "$RD_CONTAINER_RUNTIME" == "containerd" ]; then
    CRCTL=$NERDCTL
    CR_SERVICE=containerd
else
    CRCTL=$DOCKER
    CR_SERVICE=docker
fi

if is_macos; then
    CRED_HELPER="docker-credential-osxkeychain"
elif is_linux; then
    CRED_HELPER="docker-credential-pass"
fi

RDSHELL="$RDCTL shell"
RDSUDO="$RDSHELL sudo"
