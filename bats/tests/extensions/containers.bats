load '../helpers/load'

local_setup() {
    CONTAINERD_NAMESPACE=rancher-desktop-extensions
    TESTDATA_DIR_HOST=$(host_path "${PATH_BATS_ROOT}/tests/extensions/testdata/")
}

local_teardown_file() {
    if using_docker; then
        docker context use default
        docker context rm bats-invalid-context
    fi
}

id() { # variant
    echo "rd/extension/$1"
}

encoded_id() { # variant
    id "$1" | tr -d '\r\n' | base64 | tr '+/' '-_' | tr -d '='
}

@test 'factory reset' {
    factory_reset
}

@test 'start container engine' {
    start_container_engine
    wait_for_container_engine
}

@test 'default to custom docker context' {
    if ! using_docker; then
        skip 'docker context only applies when using docker backend'
    fi
    # Remove the context if it previously existed.
    run docker context rm --force bats-invalid-context
    assert_nothing
    docker context create bats-invalid-context --docker 'host=tcp://invalid.test:99999'
    docker context use bats-invalid-context
}

@test 'no extensions installed' {
    wait_for_extension_manager
    run rdctl api /v1/extensions
    assert_success
    assert_output $'\x7b'$'\x7d' # empty JSON dict, {}
    assert_dir_not_exist "$PATH_EXTENSIONS"
}

@test 'build extension testing images' {
    local extension
    for extension in vm-image vm-compose; do
        ctrctl build \
            --tag rd/extension/$extension \
            --build-arg variant=$extension "$TESTDATA_DIR_HOST"
    done
}

@test 'image - install' {
    rdctl api --method=POST "/v1/extensions/install?id=$(id vm-image)"

    run rdctl api /v1/extensions
    assert_success
    run jq_output ".[\"$(id vm-image)\"].version"
    assert_output latest
}

@test 'image - check for running container' {
    run ctrctl container ls
    assert_success
    assert_line --regexp "$(id vm-image).*[[:space:]]Up[[:space:]]"
}

@test 'image - uninstall' {
    rdctl api --method=POST "/v1/extensions/uninstall?id=$(id vm-image)"

    run ctrctl container ls --all
    assert_success
    refute_line --partial "$(id vm-image)"
}

@test 'compose - install' {
    rdctl api --method=POST "/v1/extensions/install?id=$(id vm-compose)"

    run rdctl api /v1/extensions
    assert_success
    run jq_output ".[\"$(id vm-compose)\"].version"
    assert_output latest
}

@test 'compose - check for running container' {
    run ctrctl container ls
    assert_success
    assert_line --regexp "$(id vm-compose).*[[:space:]]Up[[:space:]]"
}

@test 'compose - check for dangling symlinks' {
    if ! using_containerd; then
        skip 'This test only applies to containerd'
    fi
    assert_exists "$PATH_EXTENSIONS/$(encoded_id vm-compose)/compose/link"
    assert_not_exists "$PATH_EXTENSIONS/$(encoded_id vm-compose)/compose/dangling-link"
}

@test 'compose - uninstall' {
    rdctl api --method=POST "/v1/extensions/uninstall?id=$(id vm-compose)"

    run ctrctl container ls --all
    assert_success
    refute_line --partial "$(id vm-compose)"
}

@test 'compose - with a long name' {
    local name
    name="$(id vm-compose)-with-an-unusually-long-name-yes-it-is-very-long"

    ctrctl tag "$(id vm-compose)" "$name"
    rdctl extension install "$name"
    run ctrctl container ls --all
    assert_success
    assert_line --partial "$(id vm-compose)"
    rdctl extension uninstall "$name"
}
