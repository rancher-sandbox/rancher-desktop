# Test case 30

setup() {
    load '../helpers/load'
    if is_windows; then
        skip "test not applicable on Windows"
    fi
    # Ensure subshells don't inherit a path that includes ~/.rd/bin
    export PATH=$(echo "$PATH" | tr ':' '\n' | grep -v /.rd/bin | tr '\n' ':')
}

teardown_file() {
    load '../helpers/load'
    run rdctl shutdown
    assert_nothing
}

@test 'factory reset' {
    factory_reset
}

@test 'start app and fix dotfiles' {
    start_container_engine
    wait_for_container_engine
    ensure_dotfiles_are_completed_BUG_BUG_BUG_4519
}

# Running `bash -l -c` causes bats to hang
@test 'bash managed' {
    if command -v bash >/dev/null && [ -f "$HOME/.bashrc" ]; then
        run bash -l -c "which rdctl" 3>&-
        assert_output --partial "$HOME/.rd/bin/rdctl"
    else
        skip 'bash not found or ~/.bashrc does not exist'
    fi
}

@test 'zsh managed' {
    if command -v zsh >/dev/null && [ -f "$HOME/.zshrc" ]; then
        run zsh -i -c "which rdctl"
        assert_success
        assert_output --partial "$HOME/.rd/bin/rdctl"
    else
        skip 'zsh not found or ~/.zshrc does not exist'
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
    run grep --silent 'MANAGED BY RANCHER DESKTOP START' "$HOME/.bashrc"
    assert_failure
}

@test 'move to manual path-management' {
    rdctl set --application.path-management-strategy=manual
    try --max 5 --delay 2 no_bashrc_path_manager
    assert_success
}

@test 'bash unmanaged' {
    if command -v bash >/dev/null && [ -f "$HOME/.bashrc" ]; then
        run bash -l -c "which rdctl" 3>&-
        # Can't assert success or failure because rdctl might be in a directory other than ~/.rd/bin
        refute_output --partial "$HOME/.rd/bin/rdctl"
    else
        skip 'bash not found or ~/.bashrc does not exist'
    fi
}

@test 'zsh unmanaged' {
    if command -v zsh >/dev/null && [ -f "$HOME/.zshrc" ]; then
        run zsh -i -c "which rdctl"
        refute_output --partial "$HOME/.rd/bin/rdctl"
    else
        skip 'zsh not found or ~/.zshrc does not exist'
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
