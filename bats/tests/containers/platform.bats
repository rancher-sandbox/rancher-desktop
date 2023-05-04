load '../helpers/load'

@test 'factory reset' {
    factory_reset
}

@test 'start container engine' {
    start_container_engine
    wait_for_container_engine
}

check_uname() {
    local platform="linux/$1"
    local cpu="$2"

    # Pull container separately because `ctrctl run` doesn't have a --quiet option
    ctrctl pull --quiet --platform "$platform" busybox

    # BUG BUG BUG
    # Adding -i option to work around a bug with the Linux docker CLI in WSL
    # https://github.com/rancher-sandbox/rancher-desktop/issues/3239
    # BUG BUG BUG
    run ctrctl run -i --platform "$platform" busybox uname -m
    if is_true "${assert_success:-true}"; then
        assert_success
        assert_output "$cpu"
    fi
}

@test 'deploy amd64 container' {
    check_uname amd64 x86_64
}

@test 'deploy arm64 container' {
    if is_windows; then
        # TODO why don't we do this?
        skip "aarch64 emulation is not included in the Windows version"
    fi
    check_uname arm64 aarch64
}

@test 'uninstall s390x emulator' {
    if is_windows; then
        # On WSL the emulator might still be installed from a previous run
        ctrctl run --privileged --rm tonistiigi/binfmt --uninstall qemu-s390x
    else
        skip "only required on Windows"
    fi
}

@test 'deploy s390x container does not work' {
    assert_success=false check_uname s390x s390x
    assert_failure
    assert_output --partial "exec /bin/uname: exec format error"
}

@test 'install s390x emulator' {
    ctrctl run --privileged --rm tonistiigi/binfmt --install s390x
}

@test 'deploy s390x container' {
    check_uname s390x s390x
}
