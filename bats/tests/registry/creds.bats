setup() {
    load '../helpers/load'
    REGISTRY_IMAGE=registry:2.8.1
    REGISTRY_HOST=registry.internal
    REGISTRY_PORT=5050
    REGISTRY=$REGISTRY_HOST:$REGISTRY_PORT

    AUTH_DIR=/tmp/auth
    CAROOT=/tmp/caroot
    CERTS_DIR=/tmp/certs
}

@test 'factory reset' {
    factory_reset
}

@test 'start container engine' {
    # rdctl start \
    #       --container-engine "$RD_CONTAINER_ENGINE" \
    #       --kubernetes-enabled=false \  <=== broken in 1.4.1
    #       --suppress-sudo               <=== not implemented
    start_container_engine
    # we rely on start_container_engine to have added $REGISTRY_HOST to host
    # resover config because it is not configurable via settings, and openresty
    # will no use /etc/hosts to resolve upstream registry names.
    wait_for_shell
    if [ "${RD_USE_IMAGE_ALLOW_LIST}" != "false" ]; then
        rdctl api -X PUT -b "{\"containerEngine\":{\"imageAllowList\":{\"enabled\":true,\"patterns\":[\"$REGISTRY\",\"docker.io/registry\"]}}}" settings
    fi
}

@test 'verify image-allow-list config' {
    wait_for_container_engine
    run ctrctl pull busybox
    if [ "${RD_USE_IMAGE_ALLOW_LIST}" == "false" ]; then
        assert_success
    else
        assert_failure
        assert_output --regexp "(unauthorized|Forbidden)"
    fi
}

@test 'configure registry hostname' {
    rdsudo sh -c "printf '%s\t%s\n' \$(hostname -i) $REGISTRY_HOST >> /etc/hosts"
    # rdshell cat /etc/hosts >&3
}

@test 'create server certs for registry' {
    rdsudo apk add mkcert --force-broken-world --repository https://dl-cdn.alpinelinux.org/alpine/edge/testing
    rdshell mkdir -p $CAROOT
    rdshell CAROOT=$CAROOT TRUST_STORES=none mkcert -install
    rdshell sh -c "mkdir -p $CERTS_DIR; cd $CERTS_DIR; CAROOT=$CAROOT mkcert $REGISTRY_HOST"
}

create_registry() {
    wait_for_container_engine
    run ctrctl rm -f registry
    ctrctl run \
          --detach \
          --name registry \
          --restart always \
          -p $REGISTRY_PORT:$REGISTRY_PORT \
          -e REGISTRY_HTTP_ADDR=0.0.0.0:$REGISTRY_PORT \
          -v "$CERTS_DIR:/certs" \
          -e REGISTRY_HTTP_TLS_CERTIFICATE=/certs/$REGISTRY_HOST.pem \
          -e REGISTRY_HTTP_TLS_KEY=/certs/$REGISTRY_HOST-key.pem \
          "$@" \
          $REGISTRY_IMAGE
    wait_for_registry
}

wait_for_registry() {
    # registry port is forwarded to host
    try --max 10 --delay 5 curl -k --silent --show-error https://localhost:$REGISTRY_PORT/v2/_catalog
}

@test 'create plain registry' {
    create_registry
}

@test 'expect push image to registry to fail because CA cert has not been installed' {
    ctrctl tag $REGISTRY_IMAGE $REGISTRY/$REGISTRY_IMAGE
    run ctrctl push $REGISTRY/$REGISTRY_IMAGE
    assert_failure
    # we don't get cert errors when going through the proxy; they turn into 502's
    assert_output --regexp "(certificate signed by unknown authority|502 Bad Gateway)"
}

@test 'install CA cert' {
    rdsudo cp "$CAROOT/rootCA.pem" /usr/local/share/ca-certificates/
    rdsudo update-ca-certificates
}

@test 'restart container engine to refresh certs' {
    rdsudo $RC_SERVICE "$CONTAINER_ENGINE_SERVICE" restart
    rdsudo $RC_SERVICE --ifstarted openresty restart
    wait_for_container_engine
    # when Moby is stopped, the containers are stopped as well
    if using_docker; then
        wait_for_registry
    fi
}

@test 'expect push image to registry to succeed now' {
    ctrctl push $REGISTRY/$REGISTRY_IMAGE
}

@test 'create registry with basic auth' {
    # note: docker htpasswd **must** use bcrypt algorithm, i.e. `htpasswd -nbB user password`
    rdshell mkdir -p $AUTH_DIR
    rdshell sh -c "echo 'user:\$2y\$05\$pd/kWjYSW9x48yaPQgrl.eLn02DdMPyoYPUy/yac601k6w.okKgmG' > $AUTH_DIR/htpasswd"
    create_registry \
        -v $AUTH_DIR:/auth \
        -e REGISTRY_AUTH=htpasswd \
        -e REGISTRY_AUTH_HTPASSWD_PATH=/auth/htpasswd \
        -e REGISTRY_AUTH_HTPASSWD_REALM="Registry Realm"
}

@test 'verify that registry requires basic auth' {
    run rdshell curl --silent --show-error https://$REGISTRY/v2/_catalog
    assert_success
    assert_output --partial '"message":"authentication required"'

    run rdshell curl --silent --show-error --user user:password https://$REGISTRY/v2/_catalog
    assert_success
    assert_output '{"repositories":[]}'
}

@test 'verify that pushing fails when not logged in' {
    run bash -c "echo $REGISTRY | $CRED_HELPER erase"
    run ctrctl push $REGISTRY/$REGISTRY_IMAGE
    assert_failure
    assert_output --regexp "(401 Unauthorized|no basic auth credentials)"
}

@test 'verify that pushing succeeds after logging in' {
    run ctrctl login -u user -p password $REGISTRY
    assert_success
    assert_output --partial "Login Succeeded"

    ctrctl push $REGISTRY/$REGISTRY_IMAGE
}

@test 'verify credentials in host cred store' {
    run bash -c "echo $REGISTRY | $CRED_HELPER get"
    assert_success
    assert_output --partial '"Secret":"password"'

    ctrctl logout $REGISTRY
    run bash -c "echo $REGISTRY | $CRED_HELPER get"
    refute_output --partial '"Secret":"password"'
}
