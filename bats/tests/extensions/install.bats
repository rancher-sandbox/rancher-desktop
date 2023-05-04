load '../helpers/load'

setup() {
    TESTDATA_DIR="${PATH_BATS_ROOT}/tests/extensions/testdata/"

    if using_windows_exe; then
        TESTDATA_DIR_CLI="$(wslpath -m "${TESTDATA_DIR}")"
    else
        TESTDATA_DIR_CLI="${TESTDATA_DIR}"
    fi

    if using_containerd; then
        namespace_arg=('--namespace=rancher-desktop-extensions')
    else
        namespace_arg=()
    fi
}

assert_file_contents_equal() { # $have $want
    local have="$1" want="$2"
    assert_file_exist "$have"
    assert_file_exist "$want"

    local have_hash="$(md5sum "$have" | cut -d ' ' -f 1)"
    local want_hash="$(md5sum "$want" | cut -d ' ' -f 1)"
    if [ "$have_hash" != "$want_hash" ]; then
        printf "expected : %s (%s)\nactual   : %s (%s)" \
            "$want" "$want_hash" "$have" "$have_hash" |
            batslib_decorate "files are different" |
            fail
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
}

@test 'no extensions installed' {
    run rdctl extension ls
    assert_success
    assert_output "No extensions are installed."
    assert_dir_not_exist "$PATH_EXTENSIONS"
}

@test 'build various extension testing images' {
    local extension
    local variants=(
        basic host-binaries missing-icon missing-icon-file ui
    )
    for extension in "${variants[@]}"; do
        ctrctl "${namespace_arg[@]}" build \
            --tag "rd/extension/$extension" \
            --build-arg "variant=$extension" \
            "$TESTDATA_DIR_CLI"
    done
    run ctrctl "${namespace_arg[@]}" image list --format '{{ .Repository }}'
    assert_success
    for extension in "${variants[@]}"; do
        assert_line "rd/extension/$extension"
    done
}

@test 'basic extension - install' {
    assert_dir_not_exist "$PATH_EXTENSIONS/$(encoded_id basic)"
    rdctl extension install "$(id basic)"
}

@test 'basic extension - check extension is installed' {
    run rdctl extension ls
    assert_success
    assert_line --partial "rd/extension/basic"
}

@test 'basic extension - check extension contents' {
    assert_dir_exist "$PATH_EXTENSIONS/$(encoded_id basic)"
    assert_file_contents_equal "$PATH_EXTENSIONS/$(encoded_id basic)/icon.svg" "$TESTDATA_DIR/extension-icon.svg"
}

@test 'basic extension - uninstall' {
    rdctl extension uninstall "$(id basic)"

    run rdctl extension ls
    assert_success
    assert_output "No extensions are installed."
    assert_dir_not_exist "$PATH_EXTENSIONS/$(encoded_id basic)"
}

@test 'missing-icon - attempt to install' {
    assert_dir_not_exist "$PATH_EXTENSIONS/$(encoded_id missing-icon)"
    run rdctl extension install "$(id missing-icon)"
    assert_failure
    assert_output --partial "has invalid extension metadata"
    assert_dir_not_exist "$PATH_EXTENSIONS/$(encoded_id missing-icon)"
}

@test 'missing-icon-file - attempt to install' {
    assert_dir_not_exist "$PATH_EXTENSIONS/$(encoded_id missing-icon-file)"
    run rdctl extension install "$(id missing-icon-file)"
    assert_failure
    assert_output --partial "Could not copy icon file does-not-exist.svg"
    assert_dir_not_exist "$PATH_EXTENSIONS/$(encoded_id missing-icon-file)"
}

@test 'host-binaries - install' {
    assert_dir_not_exist "$PATH_EXTENSIONS/$(encoded_id host-binaries)"
    run rdctl extension install "$(id host-binaries)"
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
    rdctl extension uninstall "$(id host-binaries)"

    run rdctl extension ls
    assert_success
    assert_output "No extensions are installed."
    assert_dir_not_exist "$PATH_EXTENSIONS/$(encoded_id host-binaries)"
}

@test 'ui - install' {
    assert_dir_not_exist "$PATH_EXTENSIONS/$(encoded_id ui)"
    run rdctl extension install "$(id ui)"
    assert_success
}

@test 'ui - check files' {
    assert_file_exist "$PATH_EXTENSIONS/$(encoded_id ui)/ui/dashboard-tab/ui/index.html"
}

@test 'ui - uninstall' {
    rdctl extension uninstall "$(id ui)"

    run rdctl extension ls
    assert_success
    assert_output "No extensions are installed."
    assert_dir_not_exist "$PATH_EXTENSIONS/$(encoded_id ui)"
}
