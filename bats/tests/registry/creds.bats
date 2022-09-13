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

@test 'start container runtime' {
    # $RDCTL start \
    #        --container-engine "$RD_CONTAINER_RUNTIME" \
    #        --kubernetes-enabled=false \  <=== broken in 1.4.1
    #        --suppress-sudo               <=== not implemented
    start_container_runtime
    wait_for_shell
}

@test 'configure registry hostname' {
    $RDSUDO sh -c "printf '%s\t%s\n' \$(hostname -i) $REGISTRY_HOST >> /etc/hosts"
    # $RDSHELL cat /etc/hosts >&3
}

@test 'create server certs for registry' {
    $RDSUDO apk add mkcert --force-broken-world --repository https://dl-cdn.alpinelinux.org/alpine/edge/testing
    $RDSHELL mkdir -p $CAROOT
    $RDSHELL CAROOT=$CAROOT TRUST_STORES=none mkcert -install
    $RDSHELL sh -c "mkdir -p $CERTS_DIR; cd $CERTS_DIR; CAROOT=$CAROOT mkcert $REGISTRY_HOST"
}

create_registry() {
    wait_for_container_runtime
    run $CRCTL rm -f registry
    $CRCTL run \
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
    $CRCTL tag $REGISTRY_IMAGE $REGISTRY/$REGISTRY_IMAGE
    run $CRCTL push $REGISTRY/$REGISTRY_IMAGE
    assert_failure
    assert_output --partial "certificate signed by unknown authority"
}

@test 'install CA cert' {
    $RDSUDO cp "$CAROOT/rootCA.pem" /usr/local/share/ca-certificates/
    $RDSUDO update-ca-certificates
}

@test 'restart container runtime to refresh certs' {
    $RDSUDO rc-service "$CR_SERVICE" restart
    wait_for_container_runtime
    # when Moby is stopped, the containers are stopped as well
    wait_for_registry
}

@test 'expect push image to registry to succeed now' {
    $CRCTL push $REGISTRY/$REGISTRY_IMAGE
}

@test 'create registry with basic auth' {
    # note: docker htpasswd **must** use bcrypt algorithm, i.e. `htpasswd -nbB user password`
    $RDSHELL mkdir -p $AUTH_DIR
    $RDSHELL sh -c "echo 'user:\$2y\$05\$pd/kWjYSW9x48yaPQgrl.eLn02DdMPyoYPUy/yac601k6w.okKgmG' > $AUTH_DIR/htpasswd"
    create_registry \
        -v $AUTH_DIR:/auth \
        -e REGISTRY_AUTH=htpasswd \
        -e REGISTRY_AUTH_HTPASSWD_PATH=/auth/htpasswd \
        -e REGISTRY_AUTH_HTPASSWD_REALM="Registry Realm"
}

@test 'verify that registry requires basic auth' {
    run $RDSHELL curl --silent --show-error https://$REGISTRY/v2/_catalog
    assert_success
    assert_output --partial '"message":"authentication required"'

    run $RDSHELL curl --silent --show-error --user user:password https://$REGISTRY/v2/_catalog
    assert_success
    assert_output '{"repositories":[]}'
}

@test 'verify that pushing fails when not logged in' {
    run bash -c "echo $REGISTRY | $CRED_HELPER erase"
    run $CRCTL push $REGISTRY/$REGISTRY_IMAGE
    assert_failure
    assert_output --regexp "(401 Unauthorized|no basic auth credentials)"
}

@test 'verify that pushing succeeds after logging in' {
    run $CRCTL login -u user -p password $REGISTRY
    assert_success
    assert_output --partial "Login Succeeded"

    $CRCTL push $REGISTRY/$REGISTRY_IMAGE
}

@test 'verify credentials in host cred store' {
    run bash -c "echo $REGISTRY | $CRED_HELPER get"
    assert_success
    assert_output --partial '"Secret":"password"'

    $CRCTL logout $REGISTRY
    run bash -c "echo $REGISTRY | $CRED_HELPER get"
    refute_output --partial '"Secret":"password"'
}
