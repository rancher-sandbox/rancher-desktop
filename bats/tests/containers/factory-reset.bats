setup() {
    load '../helpers/load'
}

@test 'factory-reset when Rancher Desktop is not running' {
    start_application
    wait_for_apiserver "$RD_KUBERNETES_PREV_VERSION"
    # the docker context "rancher-desktop" may not have been written
    # even though the apiserver is already running
    wait_for_container_runtime
    $RDCTL shutdown
    rdctl_factory_reset --remove-kubernetes-cache=false --verbose
    check_after_factory_reset
}

@test 'factory reset - keep cached k8s images' {
    start_application
    wait_for_apiserver "$RD_KUBERNETES_PREV_VERSION"
    # the docker context "rancher-desktop" may not have been written
    # even though the apiserver is already running
    wait_for_container_runtime
    rdctl_factory_reset --remove-kubernetes-cache=false --verbose
    check_after_factory_reset
}

@test 'factory reset - delete cached k8s images' {
    start_application
    wait_for_apiserver "$RD_KUBERNETES_PREV_VERSION"
    # the docker context "rancher-desktop" may not have been written
    # even though the apiserver is already running
    wait_for_container_runtime
    rdctl_factory_reset --remove-kubernetes-cache=true --verbose
    check_after_factory_reset
}


rdctl_factory_reset() {

    if is_macos; then
      k8s_cache_dir="$HOME/Library/Caches/rancher-desktop"
    elif is_linux; then
      k8s_cache_dir="$HOME/.local/cache/rancher-desktop"
    fi
    $RDCTL factory-reset "$@"
    sleep 2
    if [[ "$1" == "--remove-kubernetes-cache=true" ]]; then
        refute [ -e "$k8s_cache_dir" ]
    elif [[ "$1" == "--remove-kubernetes-cache=false" ]]; then
        assert [ -e "$k8s_cache_dir" ]
    fi

}

check_after_factory_reset() {
# Check if all expected directories were deleted and k8s cache was preserved
    if is_macos; then
      delete_dir=("$HOME/.rd" "$HOME/Library/Applications/rancher-desktop" "$HOME/Library/Preferences/rancher-desktop" "$HOME/.docker/contexts/meta/*")
      k8s_cache_dir="$HOME/Library/Caches/rancher-desktop"
    elif is_linux; then
      delete_dir=("$HOME/.rd" "$HOME/.local/share/rancher-desktop" "$HOME/.config/rancher-desktop" "$HOME/.docker/contexts/meta/*")
      k8s_cache_dir="$HOME/.local/cache/rancher-desktop"
    fi
    for dir in "${delete_dir[@]}"; do
        echo "testing if $dir is deleted"
        assert [ ! -e "$dir" ]
    done
    # Check if docker-X symlinks were deleted
    for dfile in docker-buildx docker-compose ; do
      refute bash -c "[[ -L $HOME/.docker/cli-plugins/$dfile && \"$(readlink $HOME/.docker/cli-plugins/$dfile)\" == "$HOME/.rd/bin/$dfile" ]]"
    done
    #Check if ./rd/bin was removed from the path
    if [[ is_macos || is_linux ]]; then
    env_profiles=("$HOME/.bashrc" "$HOME/.bash_profile" "$HOME/.bash_login" "$HOME/.profile" "$HOME/.zshrc" "$HOME/.cshrc" "$HOME/.tshrc")
    fi
    for profile in "${env_profiles[@]}"; do
        run grep -F ".rd/bin:$PATH" $profile
        assert_failure
    done
    #Check if VM was killed
    if [[ is_macos || is_linux ]]; then
        run limactl ls
        assert_output --partial "No instance found"
    fi
}
