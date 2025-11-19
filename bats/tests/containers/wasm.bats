# shellcheck disable=SC2030,SC2031
# See https://github.com/koalaman/shellcheck/issues/2431
# https://www.shellcheck.net/wiki/SC2030 -- Modification of output is local (to subshell caused by @bats test)
# https://www.shellcheck.net/wiki/SC2031 -- output was modified in a subshell. That change might be lost

load '../helpers/load'

# Bundled shims are this version or newer.
BUNDLED_VERSION=0.11.1
# Manually managed versions intentionally use an older version
# so we can verify that they still override the bundled version.
MANUAL_VERSION=0.10.0

local_setup() {
    if using_containerd; then
        skip "this test only works on moby right now"
    fi
    skip "spin shim is broken with docker 28+; see #9476"
}

local_teardown_file() {
    rm -rf "$PATH_CONTAINERD_SHIMS"
}

@test 'factory reset' {
    factory_reset
    rm -rf "$PATH_CONTAINERD_SHIMS"
}

@test 'start engine without wasm support' {
    start_container_engine --experimental.container-engine.web-assembly.enabled=false
    wait_for_container_engine
}

shim_version() {
    local shim=$1
    local version=$2

    run rdctl shell "containerd-shim-${shim}-${version}" -v
    assert_success
    semver "$output"
}

@test 'verify spin shim is not installed on PATH' {
    run shim_version spin v2
    assert_failure
    assert_output --regexp 'containerd-shim-spin-v2.*(not found|No such file)'
}

hello() {
    local shim=$1
    local version=$2
    local lang=$3
    local port=$4
    local internal_port=$5

    # The '/' at the very end of the command is required by the container entrypoint.
    ctrctl run \
        --detach \
        --name "${shim}-demo-${port}" \
        --runtime "io.containerd.${shim}.${version}" \
        --platform wasi/wasm \
        --publish "${port}:${internal_port}" \
        "ghcr.io/deislabs/containerd-wasm-shims/examples/${shim}-${lang}-hello:v${MANUAL_VERSION}" /
}

@test 'verify shim is not configured in container engine' {
    run hello spin v2 rust 8080 80
    assert_nothing                           # We assert after removing the container.
    ctrctl rm --force spin-demo-8080 || true # Force delete the container if it got created.
    assert_failure
    assert_output --regexp 'operating system is not supported|binary not installed'
}

@test 'enable wasm support' {
    pid=$(get_service_pid "$CONTAINER_ENGINE_SERVICE")
    rdctl set --experimental.container-engine.web-assembly.enabled
    try --max 15 --delay 5 refute_service_pid "$CONTAINER_ENGINE_SERVICE" "$pid"
    wait_for_container_engine
}

@test "check spin shim version >= ${BUNDLED_VERSION}" {
    run shim_version spin v2
    assert_success
    semver_gte "$output" "$BUNDLED_VERSION"
}

@test 'deploy sample spin app' {
    hello spin v2 rust 8080 80
}

check_container_logs() {
    run ctrctl logs spin-demo-8080
    assert_success
    assert_output --partial "Available Routes"
}

@test 'check wasm container logs' {
    try --max 5 --delay 2 check_container_logs
}

@test 'verify wasm container is running' {
    run curl --silent --fail http://localhost:8080/hello
    assert_success
    assert_output --partial "Hello world from Spin!"

    run curl --silent --fail http://localhost:8080/go-hello
    assert_success
    assert_output --partial "Hello Spin Shim!"
}

download_shim() {
    local shim=$1
    local version=$2

    local base_url="https://github.com/deislabs/containerd-wasm-shims/releases/download/v${MANUAL_VERSION}"
    local filename="containerd-wasm-shims-${version}-${shim}-linux-${ARCH}.tar.gz"
    local host_archive

    # Since we end up using curl.exe on Windows, pass the host path to curl.
    host_archive=$(host_path "${PATH_CONTAINERD_SHIMS}/${filename}")

    mkdir -p "$PATH_CONTAINERD_SHIMS"
    curl --location --output "$host_archive" "${base_url}/${filename}"
    tar xfz "${PATH_CONTAINERD_SHIMS}/${filename}" --directory "$PATH_CONTAINERD_SHIMS"
    rm "${PATH_CONTAINERD_SHIMS}/${filename}"
}

@test 'install user-managed shims' {
    download_shim spin v2
    download_shim wws v1

    rdctl shutdown
    launch_the_application
    wait_for_container_engine
}

verify_shim() {
    local shim=$1
    local version=$2
    local lang=$3
    local port=$4
    local external_port=$5

    run shim_version "${shim}" "${version}"
    assert_success
    semver_eq "$output" "$MANUAL_VERSION"

    hello "$shim" "$version" "$lang" "$port" "$external_port"
    try --max 10 --delay 3 curl --silent --fail "http://localhost:${port}/hello"
}

@test 'verify spin shim' {
    verify_shim spin v2 rust 8181 80
    assert_output --partial "Hello world from Spin!"
}

@test 'verify wws shim' {
    verify_shim wws v1 js 8282 3000
    assert_output --partial "Hello from Wasm Workers Server"
}
