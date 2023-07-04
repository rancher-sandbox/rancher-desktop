# Test case 30

load '../helpers/load'
# Ensure subshells don't inherit a path that includes ~/.rd/bin
export PATH=$(echo "$PATH" | tr ':' '\n' | grep -v /.rd/bin | tr '\n' ':')

local_setup() {
    if is_windows; then
        skip "test not applicable on Windows"
    fi
}

@test 'factory reset' {
    factory_reset
}

@test 'start app' {
    start_container_engine
    wait_for_container_engine
    wait_for_rdctl_background_process
}

# Running `bash -l -c` can cause bats to hang, so close the output file descriptor with '3>&-'
@test 'bash managed' {
    if command -v bash >/dev/null; then
        run bash -l -c "which rdctl" 3>&-
        assert_success
        assert_output --partial "$HOME/.rd/bin/rdctl"
    else
        skip 'bash not found'
    fi
}

@test 'zsh managed' {
    if command -v zsh >/dev/null; then
        run zsh -i -c "which rdctl"
        assert_success
        assert_output --partial "$HOME/.rd/bin/rdctl"
    else
        skip 'zsh not found'
    fi
}

@test 'fish managed' {
    if command -v fish >/dev/null; then
        run fish -c "which rdctl"
        assert_success
        assert_output --partial "$HOME/.rd/bin/rdctl"
    else
        skip 'fish not found'
    fi
}

# This bashrc test assumes that this test will succeed, but it frees us
# from sleeping after changing application.path-management-strategy
no_bashrc_path_manager() {
    ! grep --silent 'MANAGED BY RANCHER DESKTOP START' "$HOME/.bashrc"
}

@test 'move to manual path-management' {
    rdctl set --application.path-management-strategy=manual
    try --max 5 --delay 2 no_bashrc_path_manager
    assert_success
}

@test 'bash unmanaged' {
    if command -v bash >/dev/null; then
        run bash -l -c "which rdctl" 3>&-
        # Can't assert success or failure because rdctl might be in a directory other than ~/.rd/bin
        refute_output --partial "$HOME/.rd/bin/rdctl"
    else
        skip 'bash not found'
    fi
}

@test 'zsh unmanaged' {
    if command -v zsh >/dev/null; then
        run zsh -i -c "which rdctl"
        refute_output --partial "$HOME/.rd/bin/rdctl"
    else
        skip 'zsh not found'
    fi
}

@test 'fish unmanaged' {
    if command -v fish >/dev/null; then
        run fish -c "which rdctl"
        refute_output --partial "$HOME/.rd/bin/rdctl"
    else
        skip 'fish not found'
    fi
}

@test 'shutdown on mac' {
    if is_macos; then
        rdctl shutdown
    fi
}
