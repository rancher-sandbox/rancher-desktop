load '../helpers/load'

@test 'initial factory reset' {
    factory_reset
}

@test 'start the app' {
    start_container_engine
    wait_for_container_engine
}

@test 'complain about windows-specific vm settings' {
    skip_on_windows
    run rdctl api /settings
    assert_success
    proxyEnabled=$(jq .experimental.virtualMachine.proxy.enabled <<<"$output")
    settingsTemplateStart='{ "version": '$(get_setting .version)', "experimental": { "virtualMachine": { "proxy":'
    settingsTemplateEnd='} } }'
    case $proxyEnabled in
    'true') oppositeEnabled=false ;;
    'false') oppositeEnabled=true ;;
    '') oppositeEnabled=true ;;
    *) oppositeEnabled=false ;;
    esac

    run rdctl api settings -X PUT --body $"$settingsTemplateStart { \"enabled\" : $oppositeEnabled } $settingsTemplateEnd"
    assert_failure
    assert_output --partial $"Changing field \"experimental.virtualMachine.proxy.enabled\" via the API isn't supported"

    for field in address password username; do
        run rdctl api settings -X PUT --body $"$settingsTemplateStart { \"$field\" :\"smorgasbord\" } $settingsTemplateEnd"
        assert_failure
        assert_output --partial "$(printf $'Changing field "experimental.virtualMachine.proxy.%s" via the API isn\'t supported' $field)"
    done

    run rdctl api settings -X PUT --body $"$settingsTemplateStart { \"port\" : -1 } $settingsTemplateEnd"
    assert_failure
    assert_output --partial $"Changing field \"experimental.virtualMachine.proxy.port\" via the API isn't supported"

    run rdctl api settings -X PUT --body $"$settingsTemplateStart { \"noproxy\" : [\"buffalo\"] } $settingsTemplateEnd"
    assert_failure
    assert_output --partial $"Changing field \"experimental.virtualMachine.proxy.noproxy\" via the API isn't supported"
}

@test 'ignores echoing current vm settings' {
    skip_on_windows
    run rdctl api /settings
    assert_success
    proxyPart=$(jq .experimental.virtualMachine.proxy <<<"$output")
    payload='{ "version": '$(get_setting .version)', "experimental": { "virtualMachine": { "proxy": '"$proxyPart"' } } }'
    run rdctl api settings -X PUT --body "$payload"
    assert_success
}
