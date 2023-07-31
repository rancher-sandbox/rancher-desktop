load '../helpers/load'

@test 'factory reset' {
    factory_reset
}

@test 'start app' {
    start_container_engine
    wait_for_container_engine
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

@test 'complains when no --input arg is specified' {
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
    assert_output --partial 'open /no/such/file/here: no such file or director'
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

@test 'report unrecognized registry sub-options' {
    run rdctl create-profile --output=reg --hive=hklm --type=ruff --from-settings
    assert_failure
    assert_output --partial 'invalid registry type of "ruff" specified'
}

# Happy tests follow

assert_full_setting_registry_output() {
    local hive=$1
    local type=$2
    assert_success
    assert_output - <<EOF
Windows Registry Editor Version 5.00
[$hive\\SOFTWARE\\Policies]
[$hive\\SOFTWARE\\Policies\\Rancher Desktop]
[$hive\\SOFTWARE\\Policies\\Rancher Desktop\\$type]
"version"=dword:9
[$hive\\SOFTWARE\\Policies\\Rancher Desktop\\$type\\application]
"adminAccess"=dword:0
"debug"=dword:1
"pathManagementStrategy"="rcfiles"
"autoStart"=dword:0
"startInBackground"=dword:0
"hideNotificationIcon"=dword:0
[$hive\\SOFTWARE\\Policies\\Rancher Desktop\\$type\\application\\extensions]
[$hive\\SOFTWARE\\Policies\\Rancher Desktop\\$type\\application\\extensions\\allowed]
"enabled"=dword:0
[$hive\\SOFTWARE\\Policies\\Rancher Desktop\\$type\\application\\telemetry]
"enabled"=dword:1
[$hive\\SOFTWARE\\Policies\\Rancher Desktop\\$type\\application\\updater]
"enabled"=dword:0
[$hive\\SOFTWARE\\Policies\\Rancher Desktop\\$type\\application\\window]
"quitOnClose"=dword:0
[$hive\\SOFTWARE\\Policies\\Rancher Desktop\\$type\\containerEngine]
"name"="containerd"
[$hive\\SOFTWARE\\Policies\\Rancher Desktop\\$type\\containerEngine\\allowedImages]
"enabled"=dword:0
"patterns"=hex(7):64,00,6f,00,63,00,6b,00,65,00,72,00,2e,00,69,00,6f,00,00,00,00,00
[$hive\\SOFTWARE\\Policies\\Rancher Desktop\\$type\\virtualMachine]
"memoryInGB"=dword:6
"numberCPUs"=dword:2
"hostResolver"=dword:1
[$hive\\SOFTWARE\\Policies\\Rancher Desktop\\$type\\kubernetes]
"version"=""
"port"=dword:192b
"enabled"=dword:0
[$hive\\SOFTWARE\\Policies\\Rancher Desktop\\$type\\kubernetes\\options]
"traefik"=dword:1
"flannel"=dword:1
[$hive\\SOFTWARE\\Policies\\Rancher Desktop\\$type\\kubernetes\\ingress]
"localhostOnly"=dword:0
[$hive\\SOFTWARE\\Policies\\Rancher Desktop\\$type\\experimental]
[$hive\\SOFTWARE\\Policies\\Rancher Desktop\\$type\\experimental\\virtualMachine]
"socketVMNet"=dword:0
"networkingTunnel"=dword:0
"type"="qemu"
"useRosetta"=dword:0
[$hive\\SOFTWARE\\Policies\\Rancher Desktop\\$type\\experimental\\virtualMachine\\mount]
"type"="reverse-sshfs"
[$hive\\SOFTWARE\\Policies\\Rancher Desktop\\$type\\experimental\\virtualMachine\\mount\\9p]
"securityModel"="none"
"protocolVersion"="9p2000.L"
"msizeInKib"=dword:80
"cacheMode"="mmap"
[$hive\\SOFTWARE\\Policies\\Rancher Desktop\\$type\\experimental\\virtualMachine\\proxy]
"enabled"=dword:0
"address"=""
"password"=""
"port"=dword:c38
"username"=""
[$hive\\SOFTWARE\\Policies\\Rancher Desktop\\$type\\portForwarding]
"includeKubernetesServices"=dword:0
[$hive\\SOFTWARE\\Policies\\Rancher Desktop\\$type\\images]
"showAll"=dword:1
"namespace"="k8s.io"
[$hive\\SOFTWARE\\Policies\\Rancher Desktop\\$type\\diagnostics]
"showMuted"=dword:0
EOF
}

assert_full_setting_plist_output() {
    assert_success
    assert_output - <<'EOF'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
  <dict>
    <key>version</key>
    <integer>9</integer>
    <key>application</key>
    <dict>
      <key>adminAccess</key>
      <false/>
      <key>debug</key>
      <true/>
      <key>extensions</key>
      <dict>
        <key>allowed</key>
        <dict>
          <key>enabled</key>
          <false/>
        </dict>
      </dict>
      <key>pathManagementStrategy</key>
      <string>rcfiles</string>
      <key>telemetry</key>
      <dict>
        <key>enabled</key>
        <true/>
      </dict>
      <key>updater</key>
      <dict>
        <key>enabled</key>
        <false/>
      </dict>
      <key>autoStart</key>
      <false/>
      <key>startInBackground</key>
      <false/>
      <key>hideNotificationIcon</key>
      <false/>
      <key>window</key>
      <dict>
        <key>quitOnClose</key>
        <false/>
      </dict>
    </dict>
    <key>containerEngine</key>
    <dict>
      <key>name</key>
      <string>containerd</string>
      <key>allowedImages</key>
      <dict>
        <key>enabled</key>
        <false/>
        <key>patterns</key>
        <array>
          <string>docker.io</string>
        </array>
      </dict>
    </dict>
    <key>virtualMachine</key>
    <dict>
      <key>memoryInGB</key>
      <integer>6</integer>
      <key>numberCPUs</key>
      <integer>2</integer>
      <key>hostResolver</key>
      <true/>
    </dict>
    <key>kubernetes</key>
    <dict>
      <key>version</key>
      <string></string>
      <key>port</key>
      <integer>6443</integer>
      <key>enabled</key>
      <false/>
      <key>options</key>
      <dict>
        <key>traefik</key>
        <true/>
        <key>flannel</key>
        <true/>
      </dict>
      <key>ingress</key>
      <dict>
        <key>localhostOnly</key>
        <false/>
      </dict>
    </dict>
    <key>experimental</key>
    <dict>
      <key>virtualMachine</key>
      <dict>
        <key>socketVMNet</key>
        <false/>
        <key>mount</key>
        <dict>
          <key>type</key>
          <string>reverse-sshfs</string>
          <key>9p</key>
          <dict>
            <key>securityModel</key>
            <string>none</string>
            <key>protocolVersion</key>
            <string>9p2000.L</string>
            <key>msizeInKib</key>
            <integer>128</integer>
            <key>cacheMode</key>
            <string>mmap</string>
          </dict>
        </dict>
        <key>networkingTunnel</key>
        <false/>
        <key>type</key>
        <string>qemu</string>
        <key>useRosetta</key>
        <false/>
        <key>proxy</key>
        <dict>
          <key>enabled</key>
          <false/>
          <key>address</key>
          <string></string>
          <key>password</key>
          <string></string>
          <key>port</key>
          <integer>3128</integer>
          <key>username</key>
          <string></string>
        </dict>
      </dict>
    </dict>
    <key>portForwarding</key>
    <dict>
      <key>includeKubernetesServices</key>
      <false/>
    </dict>
    <key>images</key>
    <dict>
      <key>showAll</key>
      <true/>
      <key>namespace</key>
      <string>k8s.io</string>
    </dict>
    <key>diagnostics</key>
    <dict>
      <key>showMuted</key>
      <false/>
    </dict>
  </dict>
</plist>
EOF
}

@test 'generates registry output for hklm/defaults' {
    run rdctl create-profile --output reg --from-settings
    assert_full_setting_registry_output HKEY_LOCAL_MACHINE defaults

    run rdctl create-profile --output reg --hive=hklm --from-settings
    assert_full_setting_registry_output HKEY_LOCAL_MACHINE defaults

    run rdctl create-profile --output reg --hive=HKLM --type=Defaults --from-settings
    assert_full_setting_registry_output HKEY_LOCAL_MACHINE defaults

    run rdctl create-profile --output reg --type=DEFAULTS --from-settings
    assert_full_setting_registry_output HKEY_LOCAL_MACHINE defaults
}

@test 'generates registry output for hklm/locked' {
    run rdctl create-profile --output reg --hive=Hklm --type=Locked --from-settings
    assert_full_setting_registry_output HKEY_LOCAL_MACHINE locked

    run rdctl create-profile --output reg --type=LOCKED --from-settings
    assert_full_setting_registry_output HKEY_LOCAL_MACHINE locked
}

@test 'generates registry output for hkcu/defaults' {
    run rdctl create-profile --output reg --hive=Hkcu --from-settings
    assert_full_setting_registry_output HKEY_CURRENT_USER defaults

    run rdctl create-profile --output reg --hive=hkcu --type=Defaults --from-settings
    assert_full_setting_registry_output HKEY_CURRENT_USER defaults
}

@test 'generates registry output for hkcu/locked' {
    run rdctl create-profile --output reg --hive=HKCU --type=locked --from-settings
    assert_full_setting_registry_output HKEY_CURRENT_USER locked
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
    assert_full_setting_plist_output
}

@test 'verify plutil is ok with the generated plist output' {
    if ! is_macos; then
        skip "Test requires the plist utility and only works on macOS"
    fi
    run rdctl create-profile --output plist --from-settings
    assert_success
    plutil -s - <<<"$output"
}

@test "don't need a running app for the rest of this test" {
    rdctl shutdown
}

complex_json_data() {
    echo '{"kubernetes": {"enabled": false}, "containerEngine": { "allowedImages": {"patterns": ["abc", "ghi", "def"] } }, "WSL": { "integrations": { "first": true, "second": false } } }'
}

assert_registry_output_for_maps_and_lists() {
    assert_success
    assert_output - <<'EOF'
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
    assert_registry_output_for_maps_and_lists
}

@test 'encodes multi-string values and maps from a json string' {
    run rdctl create-profile --output reg --hive hkcu --body "$(complex_json_data)"
    assert_registry_output_for_maps_and_lists
}

simple_json_data() {
    echo '{ "kubernetes": {"version": "moose-head" }}'
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
    run rdctl create-profile --output plist --input <(simple_json_data)
    assert_moose_head_plist_output
}

@test 'verify plutil is ok with the generated plist output from input file' {
    if ! is_macos; then
        skip "Test requires the plist utility and only works on macOS"
    fi
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

json_with_special_chars() {
    echo '{ "application": {
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
        },
        "containerEngine": {
          "name": "small-less-<-than"
        }
}'
}

# Actual output-testing of this input is done in `plist_test.go` -- the purpose of this test is to just
# make sure that we're generating compliant data.

@test 'verify converted special-char input is escaped and satisfies plutil' {
    if ! is_macos; then
        skip "Test requires the plist utility and only works on macOS"
    fi
    run rdctl create-profile --output plist --input <(json_with_special_chars)
    assert_success
    plutil -s - <<<"$output"
}

@test 'verify converted special-char output' {
    run rdctl create-profile --output plist --input <(json_with_special_chars)
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
