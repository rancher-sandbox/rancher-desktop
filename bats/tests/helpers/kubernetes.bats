load '../helpers/load'

: "${RD_INFO:=false}"

@test 'unwrap_kube_list: no list' {
    run echo '{"kind": "Pod"}'
    assert_success

    run unwrap_kube_list
    assert_success

    run jq_output .kind
    assert_success
    assert_output Pod
}

@test 'unwrap_kube_list: no items' {
    run echo '{"kind": "List"}'
    assert_success

    run unwrap_kube_list
    assert_failure
}

@test 'unwrap_kube_list: one item' {
    run echo '{"kind": "List", "items": [{"kind": "Pod"}]}'
    assert_success

    run unwrap_kube_list
    assert_success

    run jq_output .kind
    assert_success
    assert_output Pod
}

@test 'unwrap_kube_list: two items' {
    run echo '{"kind": "List", "items": [{"kind": "Pod"},{"kind": "Pod"}]}'
    assert_success

    run unwrap_kube_list
    assert_failure
}

@test 'unwrap_kube_list: not JSON' {
    run echo 'Some random error message'
    assert_success

    run unwrap_kube_list
    assert_failure
}
