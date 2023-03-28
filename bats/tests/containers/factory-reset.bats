setup() {
    load '../helpers/load'
}

@test 'factory-reset when Rancher Desktop is not running' {
    factory_reset
    start_application
    rdctl shutdown
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
    if using_docker; then
        wait_for_container_engine
    fi

    # BUG BUG BUG
    # Looks like the rcfiles don't get updated via `rdctl start`
    # BUG BUG BUG
    if is_unix; then
        rdctl set --application.path-management-strategy manual
        rdctl set --application.path-management-strategy rcfiles
    fi

    check_installation before
}

rdctl_factory_reset() {
    rdctl factory-reset "$@"

    if [[ "${1:-}" == "--remove-kubernetes-cache=true" ]]; then
        assert_not_exist "$PATH_CACHE"
    else
        assert_exists "$PATH_CACHE"
    fi
}

refute_failure() {
    assert_success
}

refute_not_exists() {
    assert_exists "$@"
}

check_installation() {
    local assert=assert
    local refute=refute

    if [ "${1-}" == "before" ]; then
        assert=refute
        refute=assert
    fi

    # Check if all expected directories were deleted and k8s cache was preserved
    delete_dir=("$PATH_APP_HOME" "$PATH_CONFIG")
    if is_unix; then
        delete_dir+=("$HOME/.rd")
        if is_macos; then
            # LIMA_HOME is under PATH_APP_HOME
            delete_dir+=("$PATH_LOGS")
        elif is_linux; then
            # Both PATH_LOGS and LIMA_HOME are under PATH_DATA
            delete_dir+=("$PATH_DATA")
        fi
        # TODO on macOS (not implemented by `rdctl factory-reset`)
        # ~/Library/Saved Application State/io.rancherdesktop.app.savedState
        # this one only exists after an update has been downloaded
        # ~/Library/Application Support/Caches/rancher-desktop-updater
    fi

    if is_windows; then
        delete_dir+=("$PATH_LOGS" "$PATH_DISTRO" "$PATH_DISTRO_DATA")
    fi

    for dir in "${delete_dir[@]}"; do
        echo "$assert that $dir does not exist"
        ${assert}_not_exists "$dir"
    done

    #Check if rancher-desktop WSL distros are deleted on Windows
    if is_windows; then
        run wsl --list
        ${refute}_output "rancher-desktop"
        ${refute}_output "rancher-desktop-data"
    fi

    # Check if docker-X symlinks were deleted
    for dfile in docker-buildx docker-compose; do
        run readlink "$HOME/.docker/cli-plugins/$dfile"
        ${refute}_output "$HOME/.rd/bin/$dfile"
    done

    # Check if ./rd/bin was removed from the path
    if is_unix; then
        # TODO add check for config.fish
        env_profiles=(
            "$HOME/.bashrc"
            "$HOME/.zshrc"
            "$HOME/.cshrc"
            "$HOME/.tcshrc"
        )
        for candidate in .bash_profile .bash_login .profile; do
            if [ -e "$HOME/$candidate" ]; then
                env_profiles+=("$HOME/$candidate")
                # Only the first candidate that exists will be modified
                if [ "${1-}" = "before" ]; then
                    break
                fi
            fi
        done

        for profile in "${env_profiles[@]}"; do
        echo "$assert that $profile does not add ~/.rd/bin to the PATH"
        # cshrc: setenv PATH "/Users/jan/.rd/bin"\:"$PATH"
        # posix: export PATH="/Users/jan/.rd/bin:$PATH"
        run grep "PATH.\"$HOME/.rd/bin" "$profile"
        ${assert}_failure
        done
    fi



    # Check if the rancher-desktop docker context has been removed
    if is_unix; then
        if using_docker; then
            echo "$assert that the docker context rancher-desktop does not exist"
            run grep -r rancher-desktop "$HOME/.docker/contexts/meta"
            ${assert}_failure
        fi
    fi

    # Check if VM was killed
    if is_unix; then
        run limactl ls
        ${assert}_output --partial "No instance found"
    fi
}
