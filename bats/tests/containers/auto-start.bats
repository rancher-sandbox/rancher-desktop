load '../helpers/load'

@test 'factory reset' {
    factory_reset
}

@test 'Start up Rancher Desktop' {
    start_application
}

get_json_key() {
    local json_key=$1
    run rdctl list-settings
    assert_success
    jq -r "${json_key}" <<<"${output}"
}

@test 'Verify that initial Behavior is all set to false' {
    run get_json_key '.application.autoStart'
    assert_output false
    run get_json_key '.application.startInBackground'
    assert_output false
    run get_json_key '.application.window.quitOnClose'
    assert_output false
    run get_json_key '.application.hideNotificationIcon'
    assert_output false
}

@test 'Enable auto start' {
    rdctl set --application.auto-start=true
    run get_json_key '.application.autoStart'
    assert_output true
}

@test 'Verify that the auto-start config is created' {

    if is_linux; then
        assert_file_exists "${XDG_CONFIG_HOME:-$HOME/.config}/autostart/rancher-desktop.desktop"
    fi

    if is_macos; then
        assert_file_exists "$HOME/Library/LaunchAgents/io.rancherdesktop.autostart.plist"
    fi

    if is_windows; then
        run powershell.exe -c "reg query HKCU\Software\Microsoft\Windows\CurrentVersion\Run /v RancherDesktop"
        assert_success
        assert_line --index 2 --partial "\Rancher Desktop\Rancher Desktop.exe"
    fi
}

@test 'Disable auto start' {
    rdctl set --application.auto-start=false
    run get_json_key '.application.autoStart'
    assert_output false
}

@test 'Verify that the auto-start config is removed' {

    if is_linux; then
        assert_file_not_exists "${XDG_CONFIG_HOME:-$HOME/.config}/autostart/rancher-desktop.desktop"
    fi

    if is_macos; then
        assert_file_not_exists "$HOME/Library/LaunchAgents/io.rancherdesktop.autostart.plist"
    fi

    if is_windows; then
        run powershell.exe -c "reg query HKCU\Software\Microsoft\Windows\CurrentVersion\Run /v RancherDesktop"
        assert_success
        assert_output --partial "The system was unable to find the specified registry"
    fi
}

@test 'Enable quit-on-close' {
    rdctl set --application.window.quit-on-close=true
    run get_json_key '.application.window.quitOnClose'
    assert_output true
}

@test 'Disable quit-on-close' {
    rdctl set --application.window.quit-on-close=false
    run get_json_key '.application.window.quitOnClose'
    assert_output false
}

@test 'Enable start-in-background' {
    rdctl set --application.start-in-background=true
    run get_json_key '.application.startInBackground'
    assert_output true
}

@test 'Disable start-in-background' {
    rdctl set --application.start-in-background=false
    run get_json_key '.application.startInBackground'
    assert_output false
}

@test 'Enable hide-notification-icon' {
    rdctl set --application.hide-notification-icon=true
    run get_json_key '.application.hideNotificationIcon'
    assert_output true
}

@test 'Disable hide-notification-icon' {
    rdctl set --application.hide-notification-icon=false
    run get_json_key '.application.hideNotificationIcon'
    assert_output false
}
