load '../helpers/load'

@test 'factory reset' {
    factory_reset
}

BOGUS_CONTAINERD_NAMESPACE=change-to-k8s.io

@test 'start app' {
    start_container_engine
    wait_for_container_engine
    rdctl set --images.namespace="$BOGUS_CONTAINERD_NAMESPACE"
}

@test 'complains when no output type is specified' {
    run rdctl create-profile --from-settings
    assert_failure
    assert_output --partial 'an "--output FORMAT" option of either "plist" or "reg" must be specified'
}

@test 'complains when an invalid output type is specified' {
    run rdctl create-profile --from-settings --output=cabbage
    assert_failure
    assert_output --partial 'received unrecognized "--output FORMAT" option of "cabbage"; "plist" or "reg" must be specified'
}

@test 'complains when no input source is specified' {
    for type in reg plist; do
        run rdctl create-profile --output $type
        assert_failure
        assert_output --partial 'no input format specified: must specify exactly one input format of "--input FILE|-", "--body|-b STRING", or "--from-settings"'
    done
}

@test 'complains when no --input or --body arg is specified' {
    for type in reg plist; do
        for input in input body; do
            run rdctl create-profile --output "$type" --"$input"
            assert_failure
            assert_output --partial $"Error: flag needs an argument: --$input"
        done
    done
}

too_many_input_formats() {
    run rdctl create-profile "$@"
    assert_failure
    assert_output --partial 'too many input formats specified: must specify exactly one input format of "--input FILE|-", "--body|-b STRING", or "--from-settings"'
}

@test 'complains when multiple input sources are specified' {
    for type in reg plist; do
        too_many_input_formats --output $type --input some-file.txt -b moose
        too_many_input_formats --output $type --input some-file.txt --from-settings
        too_many_input_formats --output $type --input some-file.txt -b moose --from-settings
        too_many_input_formats --output $type -b moose --from-settings
    done
}

@test "complains when input file doesn't exist" {
    run rdctl create-profile --output reg --input /no/such/file/here
    assert_failure
    assert_output --partial 'Error: open /no/such/file/here:'
}

@test 'report invalid parameters for plist' {
    run rdctl create-profile --output=plist --from-settings --hive=fish
    assert_failure
    assert_output --partial $"registry hive and type can't be specified with \"plist\""

    run rdctl create-profile --output plist --from-settings --type=writer
    assert_failure
    assert_output --partial $"registry hive and type can't be specified with \"plist\""
}

@test 'report unrecognized output-options' {
    run rdctl create-profile --output=pickle
    assert_failure
    assert_output --partial 'received unrecognized "--output FORMAT" option of "pickle"; "plist" or "reg" must be specified'
}

@test 'report unrecognized registry type sub-option' {
    run rdctl create-profile --output=reg --hive=hklm --type=ruff --from-settings
    assert_failure
    assert_output --partial 'invalid registry type of "ruff" specified'
}

@test 'report unrecognized registry hive sub-option' {
    run rdctl create-profile --output=reg --hive=stuff --type=locked --from-settings
    assert_failure
    assert_output --partial 'invalid registry hive of "stuff" specified'
}

@test 'report unrecognized registry hive and type sub-options reports only the bad hive' {
    run rdctl create-profile --output=reg --hive=shelves --type=cows --from-settings
    assert_failure
    assert_output --partial 'invalid registry hive of "shelves" specified'
}

# Happy tests follow

# Sample input-generating functions

json_maps_and_lists() {
    cat <<'EOF'
{
  "kubernetes": {
    "enabled": false
  },
  "containerEngine": {
    "allowedImages": {"patterns": ["abc", "ghi", "def"] }
  },
  "WSL": {
    "integrations": { "second": false, "first": true }
  },
  "application":  {
    "extensions":  {
      "allowed": {
        "enabled": true,
        "list":    []
      },
      "installed": { }
    }
  }
}
EOF
}
export -f json_maps_and_lists

simple_json_data() {
    echo '{ "kubernetes": {"version": "moose-head" }}'
}
export -f simple_json_data

# Verify that fields in this structure appear alphabetically in reg output,
# and in the same order as the settings struct in plutil output.
json_with_special_chars() {
    cat <<'EOF'
{
  "containerEngine": {
    "name": "small-less-<-than"
  },
  "application": {
    "extensions": {
        "allowed": {
          "enabled": false,
          "list": ["less-than:<", "greater:>", "and:&", "d-quote:\"", "emoji:😀"]
        },
        "installed": {
            "key-with-less-than: <": true,
            "key-with-ampersand: &": true,
            "key-with-greater-than: >": true,
            "key-with-emoji: 🐤": false
        }
    }
  }
}
EOF
}
export -f json_with_special_chars

assert_full_settings_registry_output() {
    local hive=$1
    local type=$2
    assert_success
    assert_output --partial "Windows Registry Editor Version 5.00"
    assert_output --partial "[$hive\\SOFTWARE\\Policies\\Rancher Desktop\\$type\\application]"
    assert_output --partial '"debug"=dword:1'
    assert_output --partial "[$hive\\SOFTWARE\\Policies\\Rancher Desktop\\$type\\images]"
    assert_output --partial '"namespace"="'${BOGUS_CONTAINERD_NAMESPACE}'"'
}

assert_full_settings_plist_output() {
    assert_success
    assert_output --partial '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">'
    assert_output --partial '<plist version="1.0">'
    # this next line makes sense only after <key>namespace</key>
    assert_output --partial "<string>${BOGUS_CONTAINERD_NAMESPACE}</string>"
}

@test 'generates registry output for hklm/defaults' {
    run rdctl create-profile --output reg --from-settings
    assert_full_settings_registry_output HKEY_LOCAL_MACHINE defaults

    run rdctl create-profile --output reg --hive=hklm --from-settings
    assert_full_settings_registry_output HKEY_LOCAL_MACHINE defaults

    run rdctl create-profile --output reg --hive=HKLM --type=Defaults --from-settings
    assert_full_settings_registry_output HKEY_LOCAL_MACHINE defaults

    run rdctl create-profile --output reg --type=DEFAULTS --from-settings
    assert_full_settings_registry_output HKEY_LOCAL_MACHINE defaults
}

@test 'generates registry output for hklm/locked' {
    run rdctl create-profile --output reg --hive=Hklm --type=Locked --from-settings
    assert_full_settings_registry_output HKEY_LOCAL_MACHINE locked

    run rdctl create-profile --output reg --type=LOCKED --from-settings
    assert_full_settings_registry_output HKEY_LOCAL_MACHINE locked
}

@test 'generates registry output for hkcu/defaults' {
    run rdctl create-profile --output reg --hive=Hkcu --from-settings
    assert_full_settings_registry_output HKEY_CURRENT_USER defaults

    run rdctl create-profile --output reg --hive=hkcu --type=Defaults --from-settings
    assert_full_settings_registry_output HKEY_CURRENT_USER defaults
}

# This next directive makes no sense.
# shellcheck disable=SC2030
@test 'generates registry output for hkcu/locked' {
    run rdctl create-profile --output reg --hive=HKCU --type=locked --from-settings
    assert_full_settings_registry_output HKEY_CURRENT_USER locked
}

assert_check_registry_output() {
    local bashSideTemp
    local winSideTemp
    local testFile
    local salt
    local safePolicyName

    assert_success

    # We need to formulate /tmp as a directory both sides can see.
    winSideTemp=$(wslpath -a -m /tmp)            # //wsl$/distro/tmp
    bashSideTemp=$(wslpath -a -u "$winSideTemp") # /tmp
    testFile=test.reg
    salt=$$
    # Can't write into ...\Policies\ as non-administrator, so populate a different directory.
    safePolicyName="fakeProfile${salt}"
    # shellcheck disable=SC2001,SC2031
    sed "s/Policies/${safePolicyName}/" <<<"$output" >"${bashSideTemp}/${testFile}"
    reg.exe import "${winSideTemp}\\${testFile}"
    reg.exe delete "HKCU\\Software\\${safePolicyName}\\Rancher Desktop" /f /va
    rm "${bashSideTemp}/${testFile}"
}

@test 'validate full-setting registry output on Windows' {
    if ! is_windows; then
        skip "Test requires the reg utility and only works on Windows"
    fi
    run rdctl create-profile --output reg --hive=HKCU --type=defaults --from-settings
    assert_check_registry_output
}

@test 'validate special-characters' {
    if ! is_windows; then
        skip "Test requires the reg utility and only works on Windows"
    fi
    run rdctl create-profile --output reg --hive=HKCU --type=defaults --input - <<<"$(json_with_special_chars)"
    assert_check_registry_output
}

@test 'generates registry output from inline json' {
    run rdctl create-profile --output reg --body '{"application": { "window": { "quitOnClose": true }}}'
    assert_success
    assert_output - <<'EOF'
Windows Registry Editor Version 5.00
[HKEY_LOCAL_MACHINE\SOFTWARE\Policies]
[HKEY_LOCAL_MACHINE\SOFTWARE\Policies\Rancher Desktop]
[HKEY_LOCAL_MACHINE\SOFTWARE\Policies\Rancher Desktop\defaults]
[HKEY_LOCAL_MACHINE\SOFTWARE\Policies\Rancher Desktop\defaults\application]
[HKEY_LOCAL_MACHINE\SOFTWARE\Policies\Rancher Desktop\defaults\application\window]
"quitOnClose"=dword:1
EOF
}

@test 'generates plist output from settings' {
    run rdctl create-profile --output plist --from-settings
    assert_full_settings_plist_output
}

@test 'verify plutil is ok with the generated plist output' {
    if ! is_macos; then
        skip "Test requires the plist utility and only works on macOS"
    fi
    run rdctl create-profile --output plist --from-settings
    assert_success
    plutil -s - <<<"$output"
}

# Verify that the fields given in `json_maps_and_lists` are resorted alphabetically, ignoring case
assert_registry_output_for_maps_and_lists() {
    assert_success
    assert_output - <<'EOF'
Windows Registry Editor Version 5.00
[HKEY_CURRENT_USER\SOFTWARE\Policies]
[HKEY_CURRENT_USER\SOFTWARE\Policies\Rancher Desktop]
[HKEY_CURRENT_USER\SOFTWARE\Policies\Rancher Desktop\defaults]
[HKEY_CURRENT_USER\SOFTWARE\Policies\Rancher Desktop\defaults\application]
[HKEY_CURRENT_USER\SOFTWARE\Policies\Rancher Desktop\defaults\application\extensions]
[HKEY_CURRENT_USER\SOFTWARE\Policies\Rancher Desktop\defaults\application\extensions\allowed]
"enabled"=dword:1
"list"=hex(7):00,00
[HKEY_CURRENT_USER\SOFTWARE\Policies\Rancher Desktop\defaults\application\extensions\installed]
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

@test 'encodes multi-string values and maps from a json string' {
    run rdctl create-profile --output reg --hive hkcu --body "$(json_maps_and_lists)"
    assert_registry_output_for_maps_and_lists
}

assert_moose_head_plist_output() {
    assert_success
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
    run rdctl create-profile --output plist --body "$(simple_json_data)"
    assert_moose_head_plist_output
}

@test 'verify plutil is ok with the generated plist output from input file' {
    if ! is_macos; then
        skip "Test requires the plist utility and only works on macOS"
    fi
    # This input form is ok here because it won't run in WSL/Windows
    run rdctl create-profile --output plist --input <(simple_json_data)
    assert_success
    plutil -s - <<<"$output"
}

assert_complex_plist_output() {
    assert_success
    assert_output - <<'EOF'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
  <dict>
    <key>application</key>
    <dict>
      <key>extensions</key>
      <dict>
        <key>allowed</key>
        <dict>
          <key>enabled</key>
          <true/>
          <key>list</key>
          <array>
          </array>
        </dict>
        <key>installed</key>
        <dict>
        </dict>
      </dict>
    </dict>
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
    run rdctl create-profile --output plist --body "$(json_maps_and_lists)"
    assert_complex_plist_output
}

@test 'plist-encodes multi-string values and maps from a json string' {
    run rdctl create-profile --output plist --body "$(json_maps_and_lists)"
    assert_complex_plist_output
}

# Actual output-testing of this input is done in `plist_test.go` -- the purpose of this test is to just
# make sure that we're generating compliant data.

@test 'verify converted special-char input is escaped and satisfies plutil' {
    if ! is_macos; then
        skip "Test requires the plist utility and only works on macOS"
    fi
    # This input form is ok here because it won't run in WSL/Windows
    run rdctl create-profile --output plist --input <(json_with_special_chars)
    assert_success
    plutil -s - <<<"$output"
}

@test 'verify converted special-char output' {
    run rdctl create-profile --output plist --body "$(json_with_special_chars)"
    assert_success
    assert_output - <<'END'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
  <dict>
    <key>application</key>
    <dict>
      <key>extensions</key>
      <dict>
        <key>allowed</key>
        <dict>
          <key>enabled</key>
          <false/>
          <key>list</key>
          <array>
            <string>less-than:&lt;</string>
            <string>greater:&gt;</string>
            <string>and:&amp;</string>
            <string>d-quote:&#34;</string>
            <string>emoji:😀</string>
          </array>
        </dict>
        <key>installed</key>
        <dict>
          <key>key-with-ampersand: &amp;</key>
          <true/>
          <key>key-with-emoji: 🐤</key>
          <false/>
          <key>key-with-greater-than: &gt;</key>
          <true/>
          <key>key-with-less-than: &lt;</key>
          <true/>
        </dict>
      </dict>
    </dict>
    <key>containerEngine</key>
    <dict>
      <key>name</key>
      <string>small-less-&lt;-than</string>
    </dict>
  </dict>
</plist>
END
}

@test "and shutdown" {
    if is_macos; then
        rdctl shutdown
    fi
}
