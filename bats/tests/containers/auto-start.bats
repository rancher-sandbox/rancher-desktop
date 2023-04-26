load '../helpers/load'

@test 'factory reset' {
    factory_reset
}

@test 'Start up Rancher Desktop' {
    start_application
}

get_json_key() {
    local json_key=$1
    rdctl list-settings | jq -r "${json_key}" 3>&-
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
    run rdctl set --application.auto-start=true
    assert_success
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
        assert_line --index 2 --partial "\Rancher Desktop\Rancher Desktop.exe"
    fi
}

@test 'Disable auto start' {
    run rdctl set --application.auto-start=false
    assert_success
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
        assert_output --partial "The system was unable to find the specified registry"
    fi
}

@test 'Enable quit-on-close' {
    run rdctl set --application.window.quit-on-close=true
    assert_success
    run get_json_key '.application.window.quitOnClose'
    assert_output true
}

@test 'Disable quit-on-close' {
    run rdctl set --application.window.quit-on-close=false
    assert_success
    run get_json_key '.application.window.quitOnClose'
    assert_output false
}

@test 'Enable start-in-background' {
    run rdctl set --application.start-in-background=true
    assert_success
    run get_json_key '.application.startInBackground'
    assert_output true
}

@test 'Disable start-in-background' {
    run rdctl set --application.start-in-background=false
    assert_success
    run get_json_key '.application.startInBackground'
    assert_output false
}

@test 'Enable hide-notification-icon' {
    run rdctl set --application.hide-notification-icon=true
    assert_success
    run get_json_key '.application.hideNotificationIcon'
    assert_output true
}

@test 'Disable hide-notification-icon' {
    run rdctl set --application.hide-notification-icon=false
    assert_success
    run get_json_key '.application.hideNotificationIcon'
    assert_output false
}
