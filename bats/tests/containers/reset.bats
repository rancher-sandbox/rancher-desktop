load '../helpers/load'

local_setup_file() {
    RD_USE_RAMDISK=false # interferes with deleting $PATH_APP_HOME
}

@test 'factory reset' {
    rdctl_reset --factory --cache
}

@test 'Start up Rancher Desktop' {
    start_application
}

@test 'Verify that the expected directories were created' {
    CACHE=1 before check_directories
}

@test 'Verify that docker symlinks were created' {
    before check_docker_symlinks
}

@test 'Verify that path management was set' {
    before check_path
}

@test 'Verify that rancher desktop context was created' {
    before check_rd_context
}

@test 'Verify that lima VM was created' {
    before check_lima
}

@test 'Verify that WSL distributions were created' {
    before check_WSL
}

@test 'Shutdown Rancher Desktop' {
    rdctl shutdown
}

@test 'factory-reset when Rancher Desktop is not running' {
    touch_updater_longhorn
    rdctl_reset --factory
}

@test 'Verify that the expected directories were deleted' {
    CACHE=1 check_directories
}

@test 'Verify that docker symlinks were deleted' {
    check_docker_symlinks
}

@test 'Verify that path management was unset' {
    check_path
}

@test 'Verify that rancher desktop context was deleted' {
    check_rd_context
}

@test 'Verify that lima VM was deleted' {
    check_lima
}

@test 'Verify that WSL distributions were deleted' {
    check_WSL
}

@test 'Verify updater-longhorn.json was deleted' {
    check_updater_longhorn_gone
}

@test 'Start Rancher Desktop 2' {
    start_application
}

@test 'factory reset while running - keep caches' {
    rdctl reset --factory
}

@test 'Verify that the expected directories were deleted 2' {
    CACHE=1 check_directories
}

@test 'Verify that docker symlinks were deleted 2' {
    check_docker_symlinks
}

@test 'Verify that path management was unset 2' {
    check_path
}

@test 'Verify that rancher desktop context was deleted 2' {
    check_rd_context
}

@test 'Verify that lima VM was deleted 2' {
    check_lima
}

@test 'Verify that WSL distributions were deleted 2' {
    check_WSL
}

@test 'Verify updater-longhorn.json was deleted 2' {
    check_updater_longhorn_gone
}

@test 'Start Rancher Desktop 3' {
    start_application
}

@test 'factory reset while running - delete caches' {
    rdctl_reset --factory --cache
}

@test 'Verify that the expected directories were deleted 3' {
    CACHE=0 check_directories
}

@test 'Verify that docker symlinks were deleted 3' {
    check_docker_symlinks
}

@test 'Verify that path management was unset 3' {
    check_path
}

@test 'Verify that rancher desktop context was deleted 3' {
    check_rd_context
}

@test 'Verify that lima VM was deleted 3' {
    check_lima
}

@test 'Verify that WSL distributions were deleted 3' {
    check_WSL
}

@test 'Verify updater-longhorn.json was deleted when cache was retained' {
    check_updater_longhorn_gone
}

@test 'Start up Rancher Desktop (for non-factory reset)' {
    start_application
}

@test 'Deploy kubernetes workloads' {
    CONTAINERD_NAMESPACE=k8s.io ctrctl image pull --quiet "${IMAGE_NGINX:?}"
    kubectl create deployment --replicas 2 --image "${IMAGE_NGINX:?}" bats-nginx
    kubectl wait --for=condition=Available deployment/bats-nginx
}

@test 'Make modifications to the VM' {
    rdctl shell sudo cp /etc/os-release /etc/marker-file
    rdctl shell ls -l /etc/marker-file
}

@test 'Reset only Kubernetes' {
    rdctl_reset --k8s
    wait_for_kubelet
}

@test 'Verify Kubernetes workloads removed' {
    run kubectl get deployment/bats-nginx
    assert_failure
}

@test 'Verify VM modifications persist' {
    rdctl shell ls -l /etc/marker-file
}

@test 'Re-deploy kubernetes workloads' {
    CONTAINERD_NAMESPACE=k8s.io ctrctl image pull --quiet "${IMAGE_NGINX:?}"
    kubectl create deployment --replicas 2 --image "${IMAGE_NGINX:?}" bats-nginx
    kubectl wait --for=condition=Available deployment/bats-nginx
}

@test 'Reset VM' {
    run rdctl_reset --vm
    assert_success
    assert_output 'Rancher Desktop wipe reset successful'
}

@test 'Verify VM modifications removed' {
    wait_for_shell
    rdctl shell ls -l /etc # ensure `ls` works correctly.
    run rdctl shell ls -l /etc/marker-file
    assert_failure
}

@test 'Verify Kubernetes workloads removed again' {
    wait_for_kubelet
    run kubectl get deployment/bats-nginx
    assert_failure
}

rdctl_reset() {
    capture_logs
    rdctl reset --verbose "$@"
}

check_directories() {
    # Check if all expected directories are created after starting application/ are deleted after a factory reset
    delete_dir=("$PATH_LOGS" "$PATH_APP_HOME/credential-server.json" "$PATH_APP_HOME/rd-engine.json")
    if is_unix; then
        # On Windows "$PATH_CONFIG" == "$PATH_APP_HOME"
        delete_dir+=("$HOME/.rd" "$LIMA_HOME" "$PATH_CONFIG")
        # We can't make any general assertion on AppHome/snapshots - we don't know if it was created or not
        # So just assert on the other members of AppHome
        # TODO on macOS (not implemented by `rdctl factory-reset`)
        # ~/Library/Saved Application State/io.rancherdesktop.app.savedState
        # this one only exists after an update has been downloaded
        # ~/Library/Application Support/Caches/rancher-desktop-updater
    fi

    if is_windows; then
        # On Windows $PATH_CONFIG is the same as $PATH_APP_HOME
        delete_dir+=("$PATH_CONFIG_FILE" "$PATH_DISTRO" "$PATH_DISTRO_DATA")
        # TODO: What about  $PATH_APP_HOME/vtunnel-config.yaml ?
    fi

    for dir in "${delete_dir[@]}"; do
        echo "# ${assert:?} that $dir does not exist" 1>&3
        "${assert}_not_exists" "$dir"
    done

    if is_false "${CACHE:-1}"; then
        echo "# assert that cache does not exist" >&3
        assert_not_exists "$PATH_CACHE"
    else
        echo "# assert that cache does exists" >&3
        assert_exists "$PATH_CACHE"
    fi
}

check_docker_symlinks() {
    skip_on_windows
    # Check if docker-X symlinks were deleted
    for dfile in docker-buildx docker-compose; do
        run readlink "$HOME/.docker/cli-plugins/$dfile"
        "${refute:?}_output" "$HOME/.rd/bin/$dfile"
    done
}

check_path() {
    skip_on_windows
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
        "${assert}_failure"
    done
}

check_rd_context() {
    skip_on_windows
    # Check if the rancher-desktop docker context has been removed
    if using_docker; then
        echo "$assert that the docker context rancher-desktop does not exist"
        run grep -r rancher-desktop "$HOME/.docker/contexts/meta"
        "${assert}_failure"
    fi
}

check_lima() {
    skip_on_windows
    # Check that the VM has been removed and no longer exists.
    run limactl ls
    "${assert}_output" --regexp "No instance found|no such file or directory"
}

check_WSL() {
    skip_on_unix
    # Check if rancher-desktop WSL distros are deleted on Windows
    run powershell.exe -c "wsl.exe --list"
    "${refute}_output" --partial "rancher-desktop-data"
    "${refute}_output" --partial "rancher-desktop"
}

check_updater_longhorn_gone() {
    assert_not_exists "$PATH_CACHE/updater-longhorn.json"
}

touch_updater_longhorn() {
    touch "$PATH_CACHE/updater-longhorn.json"
}
