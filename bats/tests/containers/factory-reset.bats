setup() {
    load '../helpers/load'
}

@test 'factory-reset when Rancher Desktop is not running' {
    rdctl factory-reset --verbose
    start_application
    $RDCTL shutdown
    rdctl_factory_reset --remove-kubernetes-cache=false --verbose
    check_installation
}

@test 'factory reset - keep cached k8s images' {
    start_application
    rdctl_factory_reset --remove-kubernetes-cache=false --verbose
    check_installation
}

@test 'factory reset - delete cached k8s images' {
    start_application
    rdctl_factory_reset --remove-kubernetes-cache=true --verbose
    check_installation
}

start_application() {
    start_kubernetes
    wait_for_apiserver

    # the docker context "rancher-desktop" may not have been written
    # even though the apiserver is already running
    if [ "$RD_CONTAINER_RUNTIME" != "containerd" ]; then
        wait_for_container_runtime
    fi

    # BUG BUG BUG
    # Looks like the rcfiles don't get updated via `rdctl start`
    # BUG BUG BUG
    rdctl set --path-management-strategy manual
    rdctl set --path-management-strategy rcfiles

    check_installation before
}

rdctl_factory_reset() {
    if is_macos; then
        k8s_cache_dir="$HOME/Library/Caches/rancher-desktop"
    elif is_linux; then
        k8s_cache_dir="$HOME/.local/cache/rancher-desktop"
    fi

    $RDCTL factory-reset "$@"

    if [[ "$1" == "--remove-kubernetes-cache=true" ]]; then
        refute [ -e "$k8s_cache_dir" ]
    else
        assert [ -e "$k8s_cache_dir" ]
    fi
}

refute_failure() {
    assert_success
}

check_installation() {
    local assert=assert
    local refute=refute

    if [ "${1:-}" == "before" ]; then
        assert=refute
        refute=assert
    fi

    # Check if all expected directories were deleted and k8s cache was preserved
    if is_macos; then
        delete_dir=("$HOME/.rd"
                    "$HOME/Library/Application Support/rancher-desktop"
                    "$HOME/Library/Preferences/rancher-desktop"
                    "$HOME/Library/Logs/rancher-desktop"
                   )
        # TODO (not implemented by `rdctl factory-reset`)
        # ~/Library/Saved Application State/io.rancherdesktop.app.savedState
        # this one only exists after an update has been downloaded
        # ~/Library/Application Support/Caches/rancher-desktop-updater
        k8s_cache_dir="$HOME/Library/Caches/rancher-desktop"
    elif is_linux; then
        delete_dir=("$HOME/.rd"
                    "$HOME/.local/share/rancher-desktop"
                    "$HOME/.config/rancher-desktop"
                   )
        k8s_cache_dir="$HOME/.local/cache/rancher-desktop"
    fi

    for dir in "${delete_dir[@]}"; do
        echo "$assert that $dir does not exist"
        $assert [ ! -e "$dir" ]
    done

    # Check if docker-X symlinks were deleted
    for dfile in docker-buildx docker-compose; do
        run readlink "$HOME/.docker/cli-plugins/$dfile"
        ${refute}_output "$HOME/.rd/bin/$dfile"
    done

    # Check if ./rd/bin was removed from the path
    if [[ is_macos || is_linux ]]; then
        # TODO add check for config.fish
        env_profiles=("$HOME/.bashrc"
                      "$HOME/.zshrc"
                      "$HOME/.cshrc"
                      "$HOME/.tcshrc"
                     )
        for candidate in .bash_profile .bash_login .profile; do
            if [ -e "$HOME/$candidate" ]; then
                env_profiles+=("$HOME/$candidate")
                # Only the first candidate that exists will be modified
                if [ "${1:-}" = "before" ]; then
                    break
                fi
            fi
        done
    fi

    for profile in "${env_profiles[@]}"; do
        echo "$assert that $profile does not add ~/.rd/bin to the PATH"
        # cshrc: setenv PATH "/Users/jan/.rd/bin"\:"$PATH"
        # posix: export PATH="/Users/jan/.rd/bin:$PATH"
        run grep "PATH.\"$HOME/.rd/bin" $profile
        ${assert}_failure
    done

    # Check if the rancher-desktop docker context has been removed
    if [ "$RD_CONTAINER_RUNTIME" != "containerd" ]; then
        if [[ is_macos || is_linux ]]; then
            echo "$assert that the docker context rancher-desktop does not exist"
            run grep -r rancher-desktop $HOME/.docker/contexts/meta
            ${assert}_failure
        fi
    fi

    # Check if VM was killed
    if [[ is_macos || is_linux ]]; then
        run limactl ls
        ${assert}_output --partial "No instance found"
    fi
}
