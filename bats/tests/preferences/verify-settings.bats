load '../helpers/load'

local_setup() {
    if is_windows; then
        skip "test not applicable on Windows"
    fi
}

@test 'initial factory reset' {
    factory_reset
}

@test 'start the app' {
    start_container_engine
    wait_for_container_engine
}

proxy_set() {
    local field=$1
    local value=$2

    payload=$(printf '{ "version": %d, "experimental": { "virtualMachine": { "proxy": { "%s": %s }}}}' "$(get_setting .version)" "$field" "$value")
    run rdctl api settings -X PUT --body "$payload"
    assert_failure
    assert_output --partial "Changing field \"experimental.virtualMachine.proxy.${field}\" via the API isn't supported"
}

@test 'complain about windows-specific vm settings' {
    run rdctl api /settings
    assert_success
    run jq_output .experimental.virtualMachine.proxy.enabled
    assert_success
    assert_output false

    proxy_set enabled "true"

    for field in address password username; do
        # Need to include the quotes for a string-value
        proxy_set $field '"smorgasbord"'
    done

    proxy_set port -1
    proxy_set noproxy '["buffalo"]'
}

@test 'ignores echoing current vm settings' {
    run rdctl api /settings
    assert_success
    run jq_output .experimental.virtualMachine.proxy
    assert_success
    payload=$(printf '{ "version": %s, "experimental": { "virtualMachine": { "proxy": %s } } }' "$(get_setting .version)" "$output")
    run rdctl api settings -X PUT --body "$payload"
    assert_success
}
