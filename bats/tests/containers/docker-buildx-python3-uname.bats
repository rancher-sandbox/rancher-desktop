load '../helpers/load'

local_setup() {
    if ! using_docker; then
        skip "This test only applied to the moby container engine"
    fi
    TEMP=/tmp
    if is_windows; then
        # We need to use a directory that exists on the Win32 filesystem
        # so the ctrctl clients can correctly map the bind mounts.
        # We can use host_path() on these paths because they will exist
        # both here and in the rancher-desktop distro.
        TEMP="$(win32env TEMP)"
    fi
    BUILDX_BUILDER=rd_bats_builder
    WORK_DIR="$TEMP/$BUILDX_BUILDER"
    BUILDX_INSTANCE=amd64builder
}

@test 'start' {
    factory_reset
    start_container_engine
    wait_for_container_engine
    # Do any cleanup from previous runs
    run docker buildx rm "$BUILDX_INSTANCE"
    assert_nothing
    rm -fr "$WORK_DIR"
}

@test 'create the source directory to work in' {
    mkdir -p "$WORK_DIR"
    cat >"${WORK_DIR}/Dockerfile" <<'EOF'
FROM  registry.access.redhat.com/ubi8/python-39:1-57
RUN  python3 -m pip install  tornado
CMD echo "Running on $(uname -m)"
EOF
}

@test 'build the container' {
    run docker buildx create --name "$BUILDX_INSTANCE"
    assert_success
    run docker buildx use "$BUILDX_INSTANCE"
    assert_success
    cd "$WORK_DIR"
    run docker buildx build -t testbuild:00 --platform linux/amd64 --load .
    assert_success
    run docker run testbuild:00
    assert_success
    assert_output "Running on x86_64"
}
