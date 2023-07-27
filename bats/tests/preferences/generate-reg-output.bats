load '../helpers/load'

# No rancher-desktop needed for this test
local_setup() {
    if is_windows; then
        # We need to use a directory that exists on the Win32 filesystem
        # so the ctrctl clients can correctly map the bind mounts.
        TEMP="$(win32env TEMP)"
    else
        TEMP=/tmp
    fi
}

# Bats linter doesn't know that this function calls assert_success
# so we need to do that explicitly between a `run` line and a call to this function.
verify_registry_output() {
    assert_output --partial '[HKEY_CURRENT_USER\SOFTWARE\Policies\Rancher Desktop\defaults\containerEngine]'
    assert_output --partial '[HKEY_CURRENT_USER\SOFTWARE\Policies\Rancher Desktop\defaults\containerEngine\allowedImages]'
    assert_output --partial '[HKEY_CURRENT_USER\SOFTWARE\Policies\Rancher Desktop\defaults\containerEngine\allowedImages]'
    assert_output --partial '"patterns"=hex(7):61,00,62,00,63,00,00,00,67,00,68,00,69,00,00,00,64,00,65,00,66,00,00,00,00,00'
    assert_output --partial '[HKEY_CURRENT_USER\SOFTWARE\Policies\Rancher Desktop\defaults\WSL\integrations]'
    assert_output --partial '"first"=dword:1'
    assert_output --partial '"second"=dword:0'
}

@test 'generates registry output from stdin' {
    run bash -c $'echo \'{"kubernetes": {"enabled": false}, "containerEngine": { "allowedImages": {"patterns": ["abc", "ghi", "def"] } }, "WSL": { "integrations": { "first": true, "second": false } } }\' | rdctl create-profile --output reg --hive=hkcu --input - | cat -n'
    assert_success
    verify_registry_output
}

@test 'generates registry output from inline string' {
    run rdctl create-profile --output reg --hive hkcu -b '{"kubernetes": {"enabled": false}, "containerEngine": { "allowedImages": {"patterns": ["abc", "ghi", "def"] } }, "WSL": { "integrations": { "first": true, "second": false } } }'
    assert_success
    verify_registry_output
}

@test 'generates registry output from a file' {
    local JSONFILE="$TEMP"/rdctl-reg-output.txt
    echo '{"kubernetes": {"enabled": false}, "containerEngine": { "allowedImages": {"patterns": ["abc", "ghi", "def"] } }, "WSL": { "integrations": { "first": true, "second": false } } }' >"$JSONFILE"
    run rdctl create-profile --output reg --hive=hkcu --input "$JSONFILE"
    assert_success
    verify_registry_output
    rm -f "$JSONFILE"
}

@test 'complains about both --input and --body' {
    run rdctl create-profile --output reg --hive=hkcu --input - --body blip
    assert_failure
    assert_output --partial "Error: too many output format specified: must specify exactly one output format of '--input FILE|-', '--body|-b STRING', or '--from-settings'"
}

@test 'complains about both --input and -b' {
    run rdctl create-profile --output reg --hive=hkcu --input - -b blip
    assert_failure
    assert_output --partial "Error: too many output format specified: must specify exactly one output format of '--input FILE|-', '--body|-b STRING', or '--from-settings'"
}

@test 'complains about non-json body' {
    run rdctl create-profile --output reg --hive=hkcu --body "this is not json"
    assert_failure
    assert_output --partial "Error: error in json: invalid character 'h' in literal true (expecting 'r')"
}
