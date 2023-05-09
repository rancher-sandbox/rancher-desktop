load '../helpers/load'

@test 'factory reset' {
    factory_reset
}

@test 'start app' {
    start_container_engine
    wait_for_container_engine
}

@test 'report invalid parameters for plist' {
    run rdctl create-profile --output=plist --from-settings --hive=fish
    assert_failure
    assert_output --partial "registry hive and type can't be specified with plist"
}

@test 'report unrecognized output-options' {
    run rdctl create-profile '--output=pickle'
    assert_failure
    assert_output --partial $'received unrecognized \'--output FORMAT\' option of pickle; "plist" or "reg" must be specified'
}

@test 'report unrecognized registry sub-options' {
    run rdctl create-profile --output=reg --hive=hklm --type=ruff --from-settings
    assert_failure
    assert_output --partial "invalid registry type of 'ruff' specified"
}

@test 'generates registry output for hklm/defaults' {
    run rdctl create-profile --output reg --from-settings
    assert_success
    assert_output --partial '[HKEY_LOCAL_MACHINE\SOFTWARE\Policies\Rancher Desktop\defaults\application]'

    run rdctl create-profile --output reg --hive=hklm --from-settings
    assert_success
    assert_output --partial '[HKEY_LOCAL_MACHINE\SOFTWARE\Policies\Rancher Desktop\defaults\application]'

    run rdctl create-profile --output reg --hive=HKLM --type=Defaults --from-settings
    assert_success
    assert_output --partial '[HKEY_LOCAL_MACHINE\SOFTWARE\Policies\Rancher Desktop\defaults\application]'

    run rdctl create-profile --output reg --type=DEFAULTS --from-settings
    assert_success
    assert_output --partial '[HKEY_LOCAL_MACHINE\SOFTWARE\Policies\Rancher Desktop\defaults\application]'
}

@test 'generates default registry output from inline json' {
    run rdctl create-profile --output reg --body '{"application": { "window": { "quitOnClose": true }}}'
    assert_success
    assert_output --partial '[HKEY_LOCAL_MACHINE\SOFTWARE\Policies\Rancher Desktop\defaults\application\window]'
    assert_output --partial '"quitOnClose"=dword:1'
}

@test 'generates registry output for hklm/locked' {
    run rdctl create-profile --output reg --hive=Hklm --type=Locked --from-settings
    assert_success
    assert_output --partial '[HKEY_LOCAL_MACHINE\SOFTWARE\Policies\Rancher Desktop\locked\application]'
    run rdctl create-profile --output reg --type=LOCKED --from-settings
    assert_success
    assert_output --partial '[HKEY_LOCAL_MACHINE\SOFTWARE\Policies\Rancher Desktop\locked\application]'
}

@test 'generates registry output for hkcu/defaults' {
    run rdctl create-profile --output reg --hive=Hkcu --from-settings
    assert_success
    assert_output --partial '[HKEY_CURRENT_USER\SOFTWARE\Policies\Rancher Desktop\defaults\application]'
    run rdctl create-profile --output reg --hive=hkcu --type=Defaults --from-settings
    assert_success
    assert_output --partial '[HKEY_CURRENT_USER\SOFTWARE\Policies\Rancher Desktop\defaults\application]'
}

@test 'generates registry output for hkcu/locked' {
    run rdctl create-profile --output reg --hive=HKCU --type=locked --from-settings
    assert_success
    assert_output --partial '[HKEY_CURRENT_USER\SOFTWARE\Policies\Rancher Desktop\locked\application]'
}

# The result of the `assert_output` for here-documents looks suspicious (I see it always passing),
# but this serves to document the expected full reg output
@test 'generates registry output' {
    run rdctl create-profile --output reg --from-settings
    assert_success
    # Just match a few of the lines near the start and the end of the output.
    # The unit tests do more comprehensive output checking.
    assert_output --partial '[HKEY_LOCAL_MACHINE\SOFTWARE\Policies]'
    assert_output --partial '"adminAccess"=dword:0'
    assert_output --partial '[HKEY_LOCAL_MACHINE\SOFTWARE\Policies\Rancher Desktop\defaults\diagnostics]'
    assert_output --partial '"showMuted"=dword:0'
}

@test 'complains when no output type is specified' {
    run rdctl create-profile --from-settings
    assert_failure
    assert_output --partial $"an '--output FORMAT' option of either \"plist\" or \"reg\" must be specified"
}

@test 'complains when an invalid output type is specified' {
    run rdctl create-profile --from-settings --output=cabbage
    assert_failure
    assert_output --partial $"received unrecognized '--output FORMAT' option of cabbage; \"plist\" or \"reg\" must be specified"
}

@test 'complains when no input source is specified' {
    for type in reg plist; do
        run rdctl create-profile --output $type
        assert_failure
        assert_output --partial "no output format specified: must specify exactly one output format of '--input FILE|-', '--body|-b STRING', or '--from-settings'"
    done
}

@test 'complains when multiple input sources are specified' {
    for type in reg plist; do
        run rdctl create-profile --output $type --input somefile.txt -b moose
        assert_failure
        assert_output --partial "too many output format specified: must specify exactly one output format of '--input FILE|-', '--body|-b STRING', or '--from-settings'"

        run rdctl create-profile --output $type --input somefile.txt --from-settings
        assert_failure
        assert_output --partial "too many output format specified: must specify exactly one output format of '--input FILE|-', '--body|-b STRING', or '--from-settings'"

        run rdctl create-profile --output $type --input somefile.txt -b moose --from-settings
        assert_failure
        assert_output --partial "too many output format specified: must specify exactly one output format of '--input FILE|-', '--body|-b STRING', or '--from-settings'"

        run rdctl create-profile --output $type -b moose --from-settings
        assert_failure
        assert_output --partial "too many output format specified: must specify exactly one output format of '--input FILE|-', '--body|-b STRING', or '--from-settings'"

    done
}

@test 'generates plist output from settings' {
    run rdctl create-profile --output plist --from-settings
    assert_success
    # Just match a few of the lines near the start and the end of the output.
    # The unit tests do more comprehensive output checking.
    assert_output --partial '<?xml version="1.0" encoding="UTF-8"?>'
    assert_output --partial '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">'
    assert_output --partial '<plist version="1.0">'
    assert_output --partial '    <key>application</key>'
    assert_output --partial '</plist>'
}

@test 'verify plutil is ok with the generated plist output' {
    if ! is_macos; then
        skip
    fi
    run bash -o pipefail -c "rdctl create-profile --output plist --from-settings | plutil -s -"
    assert_success
    assert_output ""
}

@test 'generates plist output from a command-line argument' {
    run rdctl create-profile --output plist --body '{ "kubernetes": {"version": "moosehead" }}'
    assert_success
    # Just match a few of the lines near the start and the end of the output.
    # The unit tests do more comprehensive output checking.
    assert_output --partial '<?xml version="1.0" encoding="UTF-8"?>'
    assert_output --partial '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">'
    assert_output --partial '<plist version="1.0">'
    assert_output --partial '<key>kubernetes</key>'
    assert_output --partial '<dict>'
    assert_output --partial '<key>version</key>'
    assert_output --partial '<string>moosehead</string>'
    assert_output --partial '</dict>'
    assert_output --partial '</plist>'
}

@test 'verify plutil is ok with the generated plist output from inline body' {
    if ! is_macos; then
        skip
    fi
    run bash -o pipefail -c $"rdctl create-profile --output plist --body '{ \"kubernetes\": {\"version\": \"moosehead\" }}' | plutil -s -"
    assert_success
    assert_output ""
}

@test 'generates plist output from a file' {
    local JSONFILE="$BATS_TEST_TMPDIR/rdctl-create-profile.txt"
    cat <<EOF >"$JSONFILE"
{ "kubernetes": {
    "version": "stillwater"
  }
}
EOF
    run rdctl create-profile --output plist --input "$JSONFILE"
    assert_success
    # Just match a few of the lines near the start and the end of the output.
    # The unit tests do more comprehensive output checking.
    assert_output --partial '<?xml version="1.0" encoding="UTF-8"?>'
    assert_output --partial '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">'
    assert_output --partial '<plist version="1.0">'
    assert_output --partial '<key>kubernetes</key>'
    assert_output --partial '<dict>'
    assert_output --partial '<key>version</key>'
    assert_output --partial '<string>stillwater</string>'
    assert_output --partial '</dict>'
    assert_output --partial '</plist>'
}

@test 'verify plutil is ok with the generated plist output from input file' {
    if ! is_macos; then
        skip
    fi
    local JSONFILE="$BATS_TEST_TMPDIR/rdctl-create-profile.txt"
    cat <<EOF >"$JSONFILE"
{ "kubernetes": {
    "version": "stillwater"
  }
}
EOF
    run bash -o pipefail -c $"rdctl create-profile --output plist --input \"$JSONFILE\" | plutil -s -"
    assert_success
    assert_output ""
}

@test 'needs a shutdown' {
    rdctl shutdown
}
