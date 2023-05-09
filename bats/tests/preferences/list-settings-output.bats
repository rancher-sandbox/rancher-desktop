load '../helpers/load'

RD_USE_IMAGE_ALLOW_LIST=true

@test 'factory reset' {
    factory_reset
    # bypass the defaults deployment file
    mkdir -p "$(dirname "${PATH_CONFIG_FILE})")"
    touch "$PATH_CONFIG_FILE"
}

@test 'start app' {
    start_container_engine
    wait_for_container_engine
}

@test 'report parameters for json' {
    run rdctl list-settings '--output=json' '--reg-hive=fish'
    assert_failure
    assert_output --partial $'registry hive and profile can\'t be specified with json'
    assert_output --partial $'registry hive and profile can\'t be specified with json'
}

@test 'report --output json is deprecated' {
    run rdctl list-settings '--output=json'
    assert_success
    assert_output --partial "DEPRECATION WARNING: rdctl list-settings --output=... is deprecated; '--output=json' is redundant"
    assert_output --partial '"containerEngine": {'
}

@test 'report --output reg is deprecated' {
    run rdctl list-settings '--output=reg'
    assert_success
    assert_output --partial "DEPRECATION WARNING: rdctl list-settings --output=reg is deprecated; please use 'rdctl create-profile..."
    assert_output --partial '[HKEY_LOCAL_MACHINE\SOFTWARE\Policies\Rancher Desktop\defaults\application\window]'
}

@test 'report unrecognized output-options' {
    run rdctl list-settings '--output=pickle,ruff'
    assert_failure
    assert_output --partial $'invalid output format of "pickle,ruff"'
}

@test 'report unrecognized reg sub-options' {
    run rdctl list-settings --output=reg --reg-hive=hklm --section=ruff
    assert_failure
    assert_output --partial "invalid registry section of 'ruff' specified"
}

@test 'generates registry output for hklm/defaults' {
    run rdctl list-settings --output reg
    assert_success
    assert_output --partial '[HKEY_LOCAL_MACHINE\SOFTWARE\Policies\Rancher Desktop\defaults\application]'

    run rdctl list-settings --output reg --reg-hive=hklm
    assert_success
    assert_output --partial '[HKEY_LOCAL_MACHINE\SOFTWARE\Policies\Rancher Desktop\defaults\application]'

    run rdctl list-settings --output reg --reg-hive=HKLM --section=Defaults
    assert_success
    assert_output --partial '[HKEY_LOCAL_MACHINE\SOFTWARE\Policies\Rancher Desktop\defaults\application]'

    run rdctl list-settings --output reg --section=DEFAULTS
    assert_success
    assert_output --partial '[HKEY_LOCAL_MACHINE\SOFTWARE\Policies\Rancher Desktop\defaults\application]'
}

@test 'generates registry output for hklm/locked' {
    run rdctl list-settings --output reg --reg-hive=Hklm --section=Locked
    assert_success
    assert_output --partial '[HKEY_LOCAL_MACHINE\SOFTWARE\Policies\Rancher Desktop\locked\application]'
    run rdctl list-settings --output reg --section=LOCKED
    assert_success
    assert_output --partial '[HKEY_LOCAL_MACHINE\SOFTWARE\Policies\Rancher Desktop\locked\application]'
}

@test 'generates registry output for hkcu/defaults' {
    run rdctl list-settings --output reg --reg-hive=Hkcu
    assert_success
    assert_output --partial '[HKEY_CURRENT_USER\SOFTWARE\Policies\Rancher Desktop\defaults\application]'
    run rdctl list-settings --output reg --reg-hive=hkcu --section=Defaults
    assert_success
    assert_output --partial '[HKEY_CURRENT_USER\SOFTWARE\Policies\Rancher Desktop\defaults\application]'
}

@test 'generates registry output for hkcu/locked' {
    run rdctl list-settings --output reg --reg-hive=HKCU --section=locked
    assert_success
    assert_output --partial '[HKEY_CURRENT_USER\SOFTWARE\Policies\Rancher Desktop\locked\application]'
}

# The result of the `assert_output` for here-documents looks suspicious (I see it always passing),
# but this serves to document the expected full reg output
@test 'generates registry output' {
    run rdctl list-settings --output reg
    assert_success
    # Just match a few of the lines near the start and the end of the output.
    # The unit tests do more comprehensive output checking.
    assert_output --partial '[HKEY_LOCAL_MACHINE\SOFTWARE\Policies]'
    assert_output --partial '"adminAccess"=dword:0'
    assert_output --partial '[HKEY_LOCAL_MACHINE\SOFTWARE\Policies\Rancher Desktop\defaults\diagnostics]'
    assert_output --partial '"showMuted"=dword:0'
}

@test 'needs a shutdown' {
    rdctl shutdown
}
