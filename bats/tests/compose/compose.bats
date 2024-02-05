load '../helpers/load'

local_setup() {
    if is_windows && using_containerd && using_windows_exe; then
         # BUG BUG BUG
         # There is a known issue of nerdctl compose not working as expected in
         # WSL distros. https://github.com/rancher-sandbox/rancher-desktop/issues/1431
         skip "Test doesn't work with nerdctl in a WSL distro"
     fi
    TESTDATA_DIR="${PATH_BATS_ROOT}/tests/compose/testdata/"
    TESTDATA_DIR_HOST=$(host_path "$TESTDATA_DIR")
}

@test 'factory reset' {
    factory_reset
}

skip_on_nerdctl_in_wsl_using_windows_exe() {
    if is_windows && using_containerd && using_windows_exe; then
        # There is a known issue of nerdctl compose not working as expected in 
        # WSL distros. https://github.com/rancher-sandbox/rancher-desktop/issues/1431
        skip "Test doesn't work with nerdctl in a WSL distro"
    fi
}

@test 'start container engine' {
    skip_on_nerdctl_in_wsl_using_windows_exe
    start_container_engine
    wait_for_container_engine
}

@test 'compose up' {
    skip_on_nerdctl_in_wsl_using_windows_exe
    run ctrctl compose --project-directory "$TESTDATA_DIR_HOST" up -d
    assert_success
}

@test 'verify app' {
    skip_on_nerdctl_in_wsl_using_windows_exe
    try --max 9 --delay 10 curl --silent --show-error "http://localhost:8000"
    assert_success
    assert_output --partial "Hello World!"
}

@test 'compose down' {
    skip_on_nerdctl_in_wsl_using_windows_exe
    run ctrctl compose --project-directory "$TESTDATA_DIR_HOST" down
    assert_success
}
