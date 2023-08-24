load '../helpers/load'

local_setup() {
    TEMP=/tmp
    if is_windows; then
        # We need to use a directory that exists on the Win32 filesystem
        # so the ctrctl clients can correctly map the bind mounts.
        # We can use host_path() on these paths because they will exist
        # both here and in the rancher-desktop distro.
        TEMP="$(win32env TEMP)"
    fi
    WORK_DIR="$TEMP/rd-bats-buildx-dockerDir"
    RD_CONTAINER_ENGINE=moby
}

@test 'start' {
    factory_reset
    start_container_engine
    wait_for_container_engine
}

@test 'create the source directory to work in' {
    mkdir -p "$WORK_DIR"
    cd "$WORK_DIR"
    cat >Dockerfile <<'EOF'
FROM  registry.access.redhat.com/ubi8/python-39:1-57

RUN  python3 -m pip install  tornado

CMD echo "Running on $(uname -m)"
EOF
}

@test 'build the container' {
    ctrctl buildx create --name amd64builder || true
    run ctrctl buildx use amd64builder
    assert_success
    cd "$WORK_DIR"
    run ctrctl buildx build -t testbuild:00 --platform linux/amd64 --load .
    if grep 'error mounting "cgroup"' <<<"$output"; then
        echo "Test is failing due to the buildkitd cgroup mounting problem" 1>&3
    fi
    assert_success
    run ctrctl run testbuild:00
    assert_success
    assert_output "Running on x86_64"
}

@test 'cleanup' {
    # Do this because `ctrctl buildx inspect | grep 'Name:.*amd64builder' && ctrctl buildx rm amd64builder`
    # doesn't work (even expanded using `run` and `<<<"$output"`
    run ctrctl buildx rm amd64builder
    assert_success
    #    rm -fr "$WORK_DIR"
}
