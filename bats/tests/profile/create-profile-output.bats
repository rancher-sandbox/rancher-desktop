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
@test 'generates registry output from settings' {
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

@test 'generates plist output from settings' {
    run rdctl create-profile --output plist --from-settings
    assert_success
    # Just match a few of the lines near the start and the end of the output.
    # The unit tests do more comprehensive output checking, as do the
    # tests that work on a subset of the JSON input.
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

@test "don't need a running app for the rest of this test" {
    rdctl shutdown
}

complex_json_data() {
    echo '{"kubernetes": {"enabled": false}, "containerEngine": { "allowedImages": {"patterns": ["abc", "ghi", "def"] } }, "WSL": { "integrations": { "first": true, "second": false } } }'
}

assert_registry_output() {
    assert_success
    assert_output --partial - <<'EOF'
Windows Registry Editor Version 5.00
[HKEY_CURRENT_USER\SOFTWARE\Policies]
[HKEY_CURRENT_USER\SOFTWARE\Policies\Rancher Desktop]
[HKEY_CURRENT_USER\SOFTWARE\Policies\Rancher Desktop\defaults]
[HKEY_CURRENT_USER\SOFTWARE\Policies\Rancher Desktop\defaults\containerEngine]
[HKEY_CURRENT_USER\SOFTWARE\Policies\Rancher Desktop\defaults\containerEngine\allowedImages]
"patterns"=hex(7):61,00,62,00,63,00,00,00,67,00,68,00,69,00,00,00,64,00,65,00,66,00,00,00,00,00
[HKEY_CURRENT_USER\SOFTWARE\Policies\Rancher Desktop\defaults\kubernetes]
"enabled"=dword:0
[HKEY_CURRENT_USER\SOFTWARE\Policies\Rancher Desktop\defaults\WSL]
[HKEY_CURRENT_USER\SOFTWARE\Policies\Rancher Desktop\defaults\WSL\integrations]
"first"=dword:1
"second"=dword:0
EOF
}

@test 'encodes multi-string values and maps from a file' {
    run rdctl create-profile --output reg --hive hkcu --input <(complex_json_data)
    assert_registry_output
}

@test 'encodes multi-string values and maps from a json string' {
    run rdctl create-profile --output reg --hive hkcu --body "$(complex_json_data)"
    assert_registry_output
}

@test 'complains when no input source is specified' {
    for type in reg plist; do
        run rdctl create-profile --output $type
        assert_failure
        assert_output --partial "no input format specified: must specify exactly one input format of '--input FILE|-', '--body|-b STRING', or '--from-settings'"
    done
}

@test 'complains when multiple input sources are specified' {
    for type in reg plist; do
        run rdctl create-profile --output $type --input some-file.txt -b moose
        assert_failure
        assert_output --partial "too many input format specified: must specify exactly one input format of '--input FILE|-', '--body|-b STRING', or '--from-settings'"

        run rdctl create-profile --output $type --input some-file.txt --from-settings
        assert_failure
        assert_output --partial "too many input format specified: must specify exactly one input format of '--input FILE|-', '--body|-b STRING', or '--from-settings'"

        run rdctl create-profile --output $type --input some-file.txt -b moose --from-settings
        assert_failure
        assert_output --partial "too many input format specified: must specify exactly one input format of '--input FILE|-', '--body|-b STRING', or '--from-settings'"

        run rdctl create-profile --output $type -b moose --from-settings
        assert_failure
        assert_output --partial "too many input format specified: must specify exactly one input format of '--input FILE|-', '--body|-b STRING', or '--from-settings'"

    done
}

simple_json_data() {
    echo '{ "kubernetes": {"version": "moose-head" }}'
}

assert_moose_head_plist_output() {
    assert_success
    # Just match a few of the lines near the start and the end of the output.
    # The unit tests do more comprehensive output checking.
    assert_output - <<'EOF'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
  <dict>
    <key>kubernetes</key>
    <dict>
      <key>version</key>
      <string>moose-head</string>
    </dict>
  </dict>
</plist>
EOF
}

@test 'generates plist output from a command-line argument' {
    run rdctl create-profile --output plist --body "$(simple_json_data)"
    assert_moose_head_plist_output
}

@test 'generates plist output from a file' {
    run rdctl create-profile --output plist --input <(simple_json_data)
    assert_moose_head_plist_output
}

@test 'verify plutil is ok with the generated plist output from input file' {
    if ! is_macos; then
        skip
    fi
    local PLIST_FILE="$BATS_TEST_TMPDIR/rdctl-create-profile.plist"
    rdctl create-profile --output plist --input <(simple_json_data) >"$PLIST_FILE"
    run plutil -s "$PLIST_FILE"
    assert_success
    assert_output ""
}

assert_complex_plist_output() {
    assert_success
    assert_output - <<'EOF'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
  <dict>
    <key>containerEngine</key>
    <dict>
      <key>allowedImages</key>
      <dict>
        <key>patterns</key>
        <array>
          <string>abc</string>
          <string>ghi</string>
          <string>def</string>
        </array>
      </dict>
    </dict>
    <key>kubernetes</key>
    <dict>
      <key>enabled</key>
      <false/>
    </dict>
    <key>WSL</key>
    <dict>
      <key>integrations</key>
      <dict>
        <key>first</key>
        <true/>
        <key>second</key>
        <false/>
      </dict>
    </dict>
  </dict>
</plist>

EOF
}

@test 'plist-encodes multi-string values and maps from a file' {
    run rdctl create-profile --output plist --input <(complex_json_data)
    assert_complex_plist_output
}

@test 'plist-encodes multi-string values and maps from a json string' {
    run rdctl create-profile --output plist --body "$(complex_json_data)"
    assert_complex_plist_output
}
