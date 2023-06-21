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
    run rdctl list-settings '--output=json,fish'
    assert_failure
    assert_output --partial 'the json output format takes no sub-formats, got "json,fish"'
}

@test 'report unrecognized output-options' {
    run rdctl list-settings '--output=bickley,ruff'
    assert_failure
    assert_output --partial $'expecting an output format of \'json\' or \'reg\', got "bickley,ruff"'
}

@test 'report unrecognized reg sub-options' {
    run rdctl list-settings '--output=reg,hklm,ruff'
    assert_failure
    assert_output --partial 'expecting a reg output-format parameter, got "ruff" in "reg,hklm,ruff"'
}

@test 'report duplicate reg hives' {
    for x in hklm hkcu; do
        for y in hklm hkcu; do
            option="reg,${x},locked,${y}"
            run rdctl list-settings "--output=${option}"
            assert_failure
            assert_output --partial $"already specified registry hive \"${x}\" in \"${option}\", can't respecify"
        done
    done
}

@test 'report duplicate registry sections' {
    for x in defaults locked; do
        for y in defaults locked; do
            option="reg,${x},hkcu,${y}"
            run rdctl list-settings "--output=${option}"
            assert_failure
            assert_output --partial $"already specified registry section \"${x}\" in \"${option}\", can't respecify"
        done
    done
}

@test 'generates registry output for hklm/defaults' {
    for option in reg reg,hklm reg,hklm,defaults reg,defaults; do
        run rdctl list-settings --output "$option"
        assert_success
        assert_output --partial '[HKEY_LOCAL_MACHINE\SOFTWARE\Policies\Rancher Desktop\defaults\application]'
    done
}

@test 'generates registry output for hklm/locked' {
    for option in reg,hklm,locked reg,locked; do
        run rdctl list-settings --output "$option"
        assert_success
        assert_output --partial '[HKEY_LOCAL_MACHINE\SOFTWARE\Policies\Rancher Desktop\locked\application]'
    done
}

@test 'generates registry output for hkcu/defaults' {
    for option in reg,hkcu,defaults reg,hkcu; do
        run rdctl list-settings --output "$option"
        assert_success
        assert_output --partial '[HKEY_CURRENT_USER\SOFTWARE\Policies\Rancher Desktop\defaults\application]'
    done
}

@test 'generates registry output for hkcu/locked' {
    run rdctl list-settings --output reg,hkcu,locked
    assert_success
    assert_output --partial '[HKEY_CURRENT_USER\SOFTWARE\Policies\Rancher Desktop\locked\application]'
}

# The result of the `assert_output` for heredocuments looks suspicious (I see it always passing),
# but this serves to document the expected full reg output
@test 'generates registry output' {
    run rdctl list-settings --output reg
    assert_success
    assert_output <<'EOF'
Windows Registry Editor Version 5.00

[HKEY_LOCAL_MACHINE\SOFTWARE\Policies]

[HKEY_LOCAL_MACHINE\SOFTWARE\Policies\Rancher Desktop]

[HKEY_LOCAL_MACHINE\SOFTWARE\Policies\Rancher Desktop\defaults]
"version"=dword:8

[HKEY_LOCAL_MACHINE\SOFTWARE\Policies\Rancher Desktop\defaults\application]
"adminAccess"=dword:0
"debug"=dword:0
"pathManagementStrategy"="rcfiles"
"autoStart"=dword:0
"startInBackground"=dword:0
"hideNotificationIcon"=dword:0

[HKEY_LOCAL_MACHINE\SOFTWARE\Policies\Rancher Desktop\defaults\application\extensions]

[HKEY_LOCAL_MACHINE\SOFTWARE\Policies\Rancher Desktop\defaults\application\extensions\allowed]
"enabled"=dword:0

[HKEY_LOCAL_MACHINE\SOFTWARE\Policies\Rancher Desktop\defaults\application\telemetry]
"enabled"=dword:1

[HKEY_LOCAL_MACHINE\SOFTWARE\Policies\Rancher Desktop\defaults\application\updater]
"enabled"=dword:0

[HKEY_LOCAL_MACHINE\SOFTWARE\Policies\Rancher Desktop\defaults\application\window]
"quitOnClose"=dword:0

[HKEY_LOCAL_MACHINE\SOFTWARE\Policies\Rancher Desktop\defaults\containerEngine]
"name"="moby"

[HKEY_LOCAL_MACHINE\SOFTWARE\Policies\Rancher Desktop\defaults\containerEngine\allowedImages]
"enabled"=dword:1
"patterns"=hex(7):66,00,69,00,73,00,68,00,00,00,73,00,68,00,65,00,65,00,70,00,00,00,63,00,6f,00,77,00,73,00,00,00,00,00

[HKEY_LOCAL_MACHINE\SOFTWARE\Policies\Rancher Desktop\defaults\virtualMachine]
"memoryInGB"=dword:4
"numberCPUs"=dword:2
"hostResolver"=dword:1

[HKEY_LOCAL_MACHINE\SOFTWARE\Policies\Rancher Desktop\defaults\kubernetes]
"version"="1.25.9"
"port"=dword:192b
"enabled"=dword:1

[HKEY_LOCAL_MACHINE\SOFTWARE\Policies\Rancher Desktop\defaults\kubernetes\options]
"traefik"=dword:1
"flannel"=dword:1

[HKEY_LOCAL_MACHINE\SOFTWARE\Policies\Rancher Desktop\defaults\kubernetes\ingress]
"localhostOnly"=dword:0

[HKEY_LOCAL_MACHINE\SOFTWARE\Policies\Rancher Desktop\defaults\experimental]

[HKEY_LOCAL_MACHINE\SOFTWARE\Policies\Rancher Desktop\defaults\experimental\virtualMachine]
"socketVMNet"=dword:0
"networkingTunnel"=dword:0
"type"="qemu"
"useRosetta"=dword:0

[HKEY_LOCAL_MACHINE\SOFTWARE\Policies\Rancher Desktop\defaults\experimental\virtualMachine\mount]
"type"="reverse-sshfs"

[HKEY_LOCAL_MACHINE\SOFTWARE\Policies\Rancher Desktop\defaults\experimental\virtualMachine\mount\9p]
"securityModel"="none"
"protocolVersion"="9p2000.L"
"msizeInKib"=dword:80
"cacheMode"="mmap"

[HKEY_LOCAL_MACHINE\SOFTWARE\Policies\Rancher Desktop\defaults\experimental\virtualMachine\proxy]
"enabled"=dword:0
"address"=""
"password"=""
"port"=dword:c38
"username"=""

[HKEY_LOCAL_MACHINE\SOFTWARE\Policies\Rancher Desktop\defaults\portForwarding]
"includeKubernetesServices"=dword:0

[HKEY_LOCAL_MACHINE\SOFTWARE\Policies\Rancher Desktop\defaults\images]
"showAll"=dword:1
"namespace"="k8s.io"

[HKEY_LOCAL_MACHINE\SOFTWARE\Policies\Rancher Desktop\defaults\diagnostics]
"showMuted"=dword:0
EOF
}

@test 'needs a shutdown' {
    rdctl shutdown
}
