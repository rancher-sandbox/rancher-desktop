setup_file() {
    load '../helpers/load'
}

setup() {
    load '../helpers/load'

    TESTDATA_DIR="${PATH_TEST_ROOT}/extensions/testdata/"
}

teardown_file() {
    run rdctl shutdown
    assert_nothing
}

id() { # variant
    echo "rd/extension/$1"
}

encoded_id() { # variant
    id "$1" | tr -d '\r\n' | base64 | tr '+/' '-_' | tr -d '='
}

namespace_arg() {
    if using_containerd; then
        echo '--namespace=rancher-desktop-extensions'
    fi
}

@test 'factory reset' {
    factory_reset
}

@test 'start container engine' {
    RD_ENV_EXTENSIONS=1 start_container_engine
    wait_for_container_engine
}

@test 'no extensions installed' {
    run rdctl api /v1/extensions
    assert_success
    assert_output $'\x7b'$'\x7d' # empty JSON dict, {}
    assert_dir_not_exist "$PATH_EXTENSIONS"
}

@test 'build extension testing images' {
    local extension
    for extension in vm-image vm-compose; do
        ctrctl build \
            "$(namespace_arg)" \
            --tag rd/extension/$extension \
            --build-arg variant=$extension "$TESTDATA_DIR"
    done
}

@test 'image - install' {
    rdctl api --method=POST "/v1/extensions/install?id=$(id vm-image)"

    run rdctl api /v1/extensions
    assert_success
    output="$(jq ".[\"$(id vm-image)\"]" <<<"${output}")"
    assert_output '"latest"'
}

@test 'image - check for running container' {
    run ctrctl "$(namespace_arg)" container ls
    assert_success
    assert_line --regexp "$(id vm-image).*[[:space:]]Up[[:space:]]"
}

@test 'image - uninstall' {
    rdctl api --method=POST "/v1/extensions/uninstall?id=$(id vm-image)"

    run ctrctl "$(namespace_arg)" container ls --all
    assert_success
    refute_line --partial "$(id vm-image)"
}

@test 'compose - install' {
    rdctl api --method=POST "/v1/extensions/install?id=$(id vm-compose)"

    run rdctl api /v1/extensions
    assert_success
    output="$(jq ".[\"$(id vm-compose)\"]" <<<"${output}")"
    assert_output '"latest"'
}

@test 'compose - check for running container' {
    run ctrctl "$(namespace_arg)" container ls
    assert_success
    assert_line --regexp "$(id vm-compose).*[[:space:]]Up[[:space:]]"
}

@test 'compose - uninstall' {
    rdctl api --method=POST "/v1/extensions/uninstall?id=$(id vm-compose)"

    run ctrctl "$(namespace_arg)" container ls --all
    assert_success
    refute_line --partial "$(id vm-compose)"
}
