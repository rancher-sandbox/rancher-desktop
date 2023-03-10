setup() {
    load '../helpers/load'

    TESTDATA_DIR="${PATH_TEST_ROOT}/extensions/testdata/"
}

teardown_file() {
    run rdctl shutdown
}

assert_file_contents_equal() { # $have $want
    local have="$1" want="$2"
    assert_file_exist "$have"
    assert_file_exist "$want"

    local have_hash="$(md5sum "$have" | cut -d ' ' -f 1)"
    local want_hash="$(md5sum "$want" | cut -d ' ' -f 1)"
    if [ "$have_hash" != "$want_hash" ]; then
        printf "expected : %s (%s)\nactual   : %s (%s)" \
            "$want" "$want_hash" "$have" "$have_hash" \
        | batslib_decorate "files are different" \
        | fail
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

@test 'no extensions installed' {
    run rdctl api /v1/extension
    assert_success
    assert_output '{}'
    assert_dir_not_exist "$PATH_EXTENSIONS"
}

@test 'build various extension testing images' {
    local extension
    for extension in basic host-binaries missing-icon missing-icon-file ui; do
        ctrctl build --tag rd/extension/$extension --build-arg variant=$extension "$TESTDATA_DIR"
    done
}

@test 'basic extension - install' {
    assert_dir_not_exist "$PATH_EXTENSIONS/$(encoded_id basic)"
    rdctl api --method=POST "/v1/extension/install?id=$(id basic)"
}

@test 'basic extension - check extension is installed' {
    run rdctl api /v1/extension
    assert_success
    output="$(jq ".[\"$(id basic)\"]" <<< "${output}")"
    assert_output true
}

@test 'basic extension - check extension contents' {
    assert_dir_exist "$PATH_EXTENSIONS/$(encoded_id basic)"
    assert_file_contents_equal "$PATH_EXTENSIONS/$(encoded_id basic)/icon.svg" "$TESTDATA_DIR/extension-icon.svg"
}

@test 'basic extension - uninstall' {
    rdctl api --method=POST "/v1/extension/uninstall?id=$(id basic)"

    run rdctl api /v1/extension
    assert_success
    assert_output '{}'
    assert_dir_not_exist "$PATH_EXTENSIONS/$(encoded_id basic)"
}

@test 'missing-icon - attempt to install' {
    assert_dir_not_exist "$PATH_EXTENSIONS/$(encoded_id missing-icon)"
    run rdctl api --method=POST "/v1/extension/install?id=$(id missing-icon)"
    assert_failure
    assert_output --partial "invalid extension metadata"
    assert_dir_not_exist "$PATH_EXTENSIONS/$(encoded_id missing-icon)"
}

@test 'missing-icon-file - attempt to install' {
    assert_dir_not_exist "$PATH_EXTENSIONS/$(encoded_id missing-icon-file)"
    run rdctl api --method=POST "/v1/extension/install?id=$(id missing-icon-file)"
    assert_failure
    assert_output --partial "Could not copy icon file does-not-exist.svg"
    assert_dir_not_exist "$PATH_EXTENSIONS/$(encoded_id missing-icon-file)"
}

@test 'host-binaries - install' {
    assert_dir_not_exist "$PATH_EXTENSIONS/$(encoded_id host-binaries)"
    run rdctl api --method=POST "/v1/extension/install?id=$(id host-binaries)"
    assert_success
}

@test 'host-binaries - check files' {
    assert_dir_exist "$PATH_EXTENSIONS/$(encoded_id host-binaries)"
    if is_windows; then
        assert_file_exist "$PATH_EXTENSIONS/$(encoded_id host-binaries)/bin/dummy.cmd"
        assert_file_not_exist "$PATH_EXTENSIONS/$(encoded_id host-binaries)/bin/dummy.sh"
    else
        assert_file_exist "$PATH_EXTENSIONS/$(encoded_id host-binaries)/bin/dummy.sh"
        assert_file_not_exist "$PATH_EXTENSIONS/$(encoded_id host-binaries)/bin/dummy.cmd"
    fi
}

@test 'host-binaries - uninstall' {
    rdctl api --method=POST "/v1/extension/uninstall?id=$(id host-binaries)"

    run rdctl api /v1/extension
    assert_success
    assert_output '{}'
    assert_dir_not_exist "$PATH_EXTENSIONS/$(encoded_id host-binaries)"
}

@test 'ui - install' {
    assert_dir_not_exist "$PATH_EXTENSIONS/$(encoded_id ui)"
    run rdctl api --method=POST "/v1/extension/install?id=$(id ui)"
    assert_success
}

@test 'ui - check files' {
    assert_file_exist "$PATH_EXTENSIONS/$(encoded_id ui)/ui/dashboard-tab/ui/index.html"
}

@test 'ui - uninstall' {
    rdctl api --method=POST "/v1/extension/uninstall?id=$(id ui)"

    run rdctl api /v1/extension
    assert_success
    assert_output '{}'
    assert_dir_not_exist "$PATH_EXTENSIONS/$(encoded_id ui)"
}
