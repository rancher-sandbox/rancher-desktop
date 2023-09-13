# verify that running a container with --init is working

load '../helpers/load'

@test 'factory reset' {
    factory_reset
}

@test 'start container engine' {
    start_container_engine
    wait_for_container_engine
}

@test 'run container with init process' {
    # BUG BUG BUG
    # The following `ctrctl run` command includes the `-i` option to work around a docker
    # bug on Windows: https://github.com/rancher-sandbox/rancher-desktop/issues/3239
    # It is harmless in other configurations, but should not be required here.
    # BUG BUG BUG
    run ctrctl run -i --rm --init "$IMAGE_BUSYBOX" ps -ef
    assert_success
    # PID   USER     TIME  COMMAND
    #     1 root      0:00 /sbin/docker-init -- ps -ef
    #     1 root      0:00 /sbin/tini -- ps -ef
    assert_line --regexp '^ +1 .+ /sbin/(docker-init|tini) -- ps -ef$'
}
