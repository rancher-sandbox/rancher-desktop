setup() {
    load '../helpers/load'
}

@test 'factory reset' {
    factory_reset
}

@test 'Start up Rancher Desktop' {
    start_application
}

@test 'Verify that the expected directories were created' {
    check_directories before
}

@test 'Verify that docker symlinks were created' {
    if is_unix; then
        check_docker_symlinks before
    else
        skip "This test is not applicable on Windows. Skipping..."
    fi
}

@test 'Verify that path management was set' {
    if is_unix; then
        check_path before
    else
        skip "This test is not applicable on Windows. Skipping..."
    fi
}

@test 'Verify that rancher desktop context was created' {
    if is_unix; then
        check_rd_context before
    else
        skip "This test is not applicable on Windows. Skipping..."
    fi
}

@test 'Verify that lima VM was created' {
    if is_unix; then
        check_lima before
    else
        skip "This test is not applicable on Windows. Skipping..."
    fi
}

@test 'Verify that WSL distributions were created' {
    if is_windows; then
        check_WSL before
    else
        skip "This test is not applicable on MacOS/Linux. Skipping..."
    fi
}

@test 'Shutdown Rancher Desktop' {
    rdctl shutdown
}
@test 'factory-reset when Rancher Desktop is not running' {
    rdctl_factory_reset --verbose
}

@test 'Verify that the expected directories were deleted' {
    check_directories
}

@test 'Verify that docker symlinks were deleted' {
    if is_unix; then
        check_docker_symlinks
    else
        skip "This test is not applicable on Windows. Skipping..."
    fi
}

@test 'Verify that path management was unset' {
    if is_unix; then
        check_path
    else
        skip "This test is not applicable on Windows. Skipping..."
    fi
}

@test 'Verify that rancher desktop context was deleted' {
    if is_unix; then
        check_rd_context
    else
        skip "This test is not applicable on Windows. Skipping..."
    fi
}

@test 'Verify that lima VM was deleted' {
    if is_unix; then
        check_lima
    else
        skip "This test is not applicable on Windows. Skipping..."
    fi
}

@test 'Verify that WSL distributions were deleted' {
    if is_windows; then
        check_WSL
    else
        skip "This test is not applicable on MacOS/Linux. Skipping..."
    fi
}

@test 'Start Rancher Desktop 2' {
    start_application
}

@test 'factory reset - keep cached k8s images' {
    rdctl_factory_reset --remove-kubernetes-cache=false --verbose
}

@test 'Verify that the expected directories were deleted 2' {
    check_directories
}

@test 'Verify that docker symlinks were deleted 2' {
    if is_unix; then
        check_docker_symlinks
    else
        skip "This test is not applicable on Windows. Skipping..."
    fi
}

@test 'Verify that path management was unset 2' {
    if is_unix; then
        check_path
    else
        skip "This test is not applicable on Windows. Skipping..."
    fi
}

@test 'Verify that rancher desktop context was deleted 2' {
    if is_unix; then
        check_rd_context
    else
        skip "This test is not applicable on Windows. Skipping..."
    fi
}

@test 'Verify that lima VM was deleted 2' {
    if is_unix; then
        check_lima
    else
        skip "This test is not applicable on Windows. Skipping..."
    fi
}

@test 'Verify that WSL distributions were deleted 2' {
    if is_windows; then
        check_WSL
    else
        skip "This test is not applicable on MacOS/Linux. Skipping..."
    fi
}

@test 'Start Rancher Desktop 3' {
    start_application
}

@test 'factory reset - delete cached k8s images' {
    rdctl_factory_reset --remove-kubernetes-cache=true --verbose
}

@test 'Verify that the expected directories were deleted 3' {
    check_directories
}

@test 'Verify that docker symlinks were deleted 3' {
    if is_unix; then
        check_docker_symlinks
    else
        skip "This test is not applicable on Windows. Skipping..."
    fi
}

@test 'Verify that path management was unset 3' {
    if is_unix; then
        check_path
    else
        skip "This test is not applicable on Windows. Skipping..."
    fi
}

@test 'Verify that rancher desktop context was deleted 3' {
    if is_unix; then
        check_rd_context
    else
        skip "This test is not applicable on Windows. Skipping..."
    fi
}

@test 'Verify that lima VM was deleted 3' {
    if is_unix; then
        check_lima
    else
        skip "This test is not applicable on Windows. Skipping..."
    fi
}

@test 'Verify that WSL distributions were deleted 3' {
    if is_windows; then
        check_WSL
    else
        skip "This test is not applicable on MacOS/Linux. Skipping..."
    fi
}

rdctl_factory_reset() {
    rdctl factory-reset "$@"

    if [[ $1 == "--remove-kubernetes-cache=true" ]]; then
        assert_not_exist "$PATH_CACHE"
        if is_windows; then
            assert_not_exist "$PATH_DATA"
        fi
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

check_directories() {
    local assert=assert
    local refute=refute

    if [ "${1-}" == "before" ]; then
        assert=refute
        refute=assert
    fi
    # Check if all expected directories are created after starting application/ are deleted after a factory reset
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
        "${assert}"_not_exists "$dir"
    done
}

check_docker_symlinks() {
    local assert=assert
    local refute=refute

    if [ "${1-}" == "before" ]; then
        assert=refute
        refute=assert
    fi
    # Check if docker-X symlinks were deleted
    for dfile in docker-buildx docker-compose; do
        run readlink "$HOME/.docker/cli-plugins/$dfile"
        "${refute}"_output "$HOME/.rd/bin/$dfile"
    done
}

check_path() {
    local assert=assert
    local refute=refute

    if [ "${1-}" == "before" ]; then
        assert=refute
        refute=assert
    fi
    # Check if ./rd/bin was removed from the path
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
            if [ "${assert}" = "refute" ]; then
                break
            fi
        fi
    done

    for profile in "${env_profiles[@]}"; do
        echo "$assert that $profile does not add ~/.rd/bin to the PATH"
        # cshrc: setenv PATH "/Users/jan/.rd/bin"\:"$PATH"
        # posix: export PATH="/Users/jan/.rd/bin:$PATH"
        run grep "PATH.\"$HOME/.rd/bin" "$profile"
        "${assert}"_failure
    done
}

check_rd_context() {
    local assert=assert
    local refute=refute

    if [ "${1-}" == "before" ]; then
        assert=refute
        refute=assert
    fi
    # Check if the rancher-desktop docker context has been removed
    if using_docker; then
        echo "$assert that the docker context rancher-desktop does not exist"
        run grep -r rancher-desktop "$HOME/.docker/contexts/meta"
        "${assert}"_failure
    fi
}

check_lima() {
    local assert=assert
    local refute=refute

    if [ "${1-}" == "before" ]; then
        assert=refute
        refute=assert
    fi
    # Check if VM was killed
    run limactl ls
    "${assert}"_output --partial "No instance found"
}

check_WSL() {
    local assert=assert
    local refute=refute

    if [ "${1-}" == "before" ]; then
        assert=refute
        refute=assert
    fi
    # Check if rancher-desktop WSL distros are deleted on Windows
    run powershell.exe -c "wsl.exe --list"
    "${refute}"_line --partial "rancher-desktop-data"
    "${refute}"_line --partial "rancher-desktop"
}
