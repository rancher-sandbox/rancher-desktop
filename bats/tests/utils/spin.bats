load '../helpers/load'

# Verify that enabling Wasm support will install spin plugins and templates

local_setup() {
    SPIN_DATA_DIR="${PATH_APP_HOME}/spin"
}

cmd_exe() {
    "${SYSTEMROOT}/system32/cmd.exe" /c "$@"
}

dir_exists() {
    if using_windows_exe; then
        run --separate-stderr cmd_exe if exist "$(host_path "$1")" echo True
        # Output may have trailing \r
        [[ $output =~ ^True ]]
    else
        [[ -d $1 ]]
    fi
}

@test 'delete spin plugins and templates' {
    if using_windows_exe; then
        run cmd_exe rmdir /s /q "$(host_path "${SPIN_DATA_DIR:?}")"
        assert_nothing
    else
        rm -rf "${SPIN_DATA_DIR:?}"
    fi
}

@test 'confirm the spin directory is gone' {
    run dir_exists "$SPIN_DATA_DIR"
    assert_failure
}

@test 'start container engine with wasm support enabled' {
    factory_reset
    start_container_engine --experimental.container-engine.web-assembly.enabled
    wait_for_container_engine
}

@test 'plugins are installed' {
    run dir_exists "${SPIN_DATA_DIR}/plugins/kube"
    assert_success
}

@test 'templates are installed' {
    if using_windows_exe; then
        run --separate-stderr cmd_exe dir /b "$(host_path "${SPIN_DATA_DIR}/templates")"
        assert_success
    else
        run ls -1 "${SPIN_DATA_DIR}/templates"
        assert_success
    fi
    assert_line --regexp "^http-go_" # from spin
    assert_line --regexp "^http-js_" # from spin-js-sdk
    assert_line --regexp "^http-py_" # from spin-python-sdk
}
