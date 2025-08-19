load '../helpers/load'

local_setup() {
    CONTAINERD_NAMESPACE=rancher-desktop-extensions
    TESTDATA_DIR="${PATH_BATS_ROOT}/tests/extensions/testdata/"
    TESTDATA_DIR_HOST=$(host_path "$TESTDATA_DIR")
}

assert_file_contents_equal() { # $have $want
    local have="$1" want="$2"
    assert_file_exist "$have"
    assert_file_exist "$want"

    local have_hash want_hash
    # md5sum is not available on macOS unless you install GNU coreutils
    have_hash="$(openssl md5 -r "$have" | cut -d ' ' -f 1)"
    want_hash="$(openssl md5 -r "$want" | cut -d ' ' -f 1)"
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
    start_container_engine
    wait_for_container_engine
    wait_for_extension_manager
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
        ctrctl build \
            --tag "rd/extension/$extension" \
            --build-arg "variant=$extension" \
            "$TESTDATA_DIR_HOST"
    done
    run ctrctl image list --format '{{ .Repository }}'
    assert_success
    for extension in "${variants[@]}"; do
        assert_line "rd/extension/$extension"
    done
}

@test 'extension API - require auth' {
    local port
    run cat "${PATH_APP_HOME}/rd-engine.json"
    assert_success
    port="$(jq_output .port)"
    assert [ -n "$port" ]
    run curl --fail "http://127.0.0.1:${port}/v1/settings"
    assert_failure
    assert_output --partial "The requested URL returned error: 401"
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

@test 'basic extension - upgrades' {
    local tag
    ctrctl image tag "$(id basic)" "$(id basic):0.0.1"
    ctrctl image tag "$(id basic)" "$(id basic):v0.0.2"

    run rdctl extension ls
    assert_success
    assert_line --partial "$(id basic):latest"

    rdctl extension install "$(id basic)"
    run rdctl extension ls
    assert_success
    # The highest semver tag should be installed, replacing the existing one.
    assert_line --partial "$(id basic):v0.0.2"
}

@test 'basic extension - uninstalling not installed version' {
    rdctl extension uninstall "$(id basic):0.0.1"
    run rdctl extension ls
    assert_success
    # Trying to uninstall a version that isn't installed should be a no-op
    assert_line --partial "$(id basic):v0.0.2"
}

@test 'basic extension - uninstall' {
    ctrctl image tag "$(id basic)" "$(id basic):0.0.3"
    # Uninstall should remove whatever version is installed, not the newest.
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

@test 'host-binaries - check extension is installed' {
    run rdctl extension ls
    assert_success
    assert_output --partial "rd/extension/host-binaries:latest"
}

@test 'host-binaries - check files' {
    assert_dir_exist "$PATH_EXTENSIONS/$(encoded_id host-binaries)"
    if is_windows; then
        assert_file_exist "$PATH_EXTENSIONS/$(encoded_id host-binaries)/bin/dummy.exe"
        assert_file_not_exist "$PATH_EXTENSIONS/$(encoded_id host-binaries)/bin/dummy.sh"
    else
        assert_file_exist "$PATH_EXTENSIONS/$(encoded_id host-binaries)/bin/dummy.sh"
        assert_file_not_exist "$PATH_EXTENSIONS/$(encoded_id host-binaries)/bin/dummy.exe"
    fi
}

@test 'host-binaries - upgrade' {
    # We test upgrades with host-binaries as there was a bug about reinstalling
    # an extension with host binaries.
    ctrctl image tag "$(id host-binaries)" "$(id host-binaries):0.0.1"
    ctrctl image tag "$(id host-binaries)" "$(id host-binaries):v0.0.2"

    run rdctl extension ls
    assert_success
    assert_line --partial "$(id host-binaries):latest"

    rdctl extension install "$(id host-binaries)"
    run rdctl extension ls
    assert_success
    # The highest semver tag should be installed, replacing the existing one.
    assert_line --partial "$(id host-binaries):v0.0.2"
}

@test 'host-binaries - uninstalling not installed version' {
    rdctl extension uninstall "$(id host-binaries):0.0.1"
    run rdctl extension ls
    assert_success
    # Trying to uninstall a version that isn't installed should be a no-op
    assert_line --partial "$(id host-binaries):v0.0.2"
}

@test 'host-binaries - uninstall' {
    ctrctl image tag "$(id host-binaries)" "$(id host-binaries):0.0.3"
    # Uninstall should remove whatever version is installed, not the newest.

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
