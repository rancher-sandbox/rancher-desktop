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

CRED_HELPER="docker-credential-osxkeychain"

RDSHELL="$RDCTL shell"
RDSUDO="$RDSHELL sudo"
