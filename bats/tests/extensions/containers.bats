load '../helpers/load'

local_setup() {
    CONTAINERD_NAMESPACE=rancher-desktop-extensions

    TESTDATA_DIR="${PATH_BATS_ROOT}/tests/extensions/testdata/"
    if using_windows_exe; then
        TESTDATA_DIR="$(wslpath -m "${TESTDATA_DIR}")"
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
    RD_ENV_EXTENSIONS=1 start_container_engine
    wait_for_container_engine
    wait_for_rdctl_background_process
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
            --tag rd/extension/$extension \
            --build-arg variant=$extension "$TESTDATA_DIR"
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
    local name="$(id vm-compose)-with-an-unusually-long-name-yes-it-is-very-long"

    ctrctl tag "$(id vm-compose)" "$name"
    rdctl extension install "$name"
    run ctrctl container ls --all
    assert_success
    assert_line --partial "$(id vm-compose)"
    rdctl extension uninstall "$name"
}
