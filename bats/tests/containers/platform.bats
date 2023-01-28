setup() {
    load '../helpers/load'
}

@test 'factory reset' {
    factory_reset
}

@test 'start container runtime' {
    start_container_engine
    wait_for_container_engine
}

check_uname() {
    local platform="linux/$1"
    local cpu="$2"

    # Pull container separately because `ctrctl run` doesn't have a --quiet option
    ctrctl pull --quiet --platform "$platform" busybox

    run ctrctl run --platform "$platform" busybox uname -m
    if [ "${assert_success:-true}" = "true" ]; then
        assert_success
        assert_output "$cpu"
    fi
}

@test 'deploy amd64 container' {
    check_uname amd64 x86_64
}

@test 'deploy arm64 container' {
    check_uname arm64 aarch64
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
