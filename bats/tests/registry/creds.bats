load '../helpers/load'

setup() {
    REGISTRY_IMAGE="registry:2.8.1"
    REGISTRY_PORT="5050"
    DOCKER_CONFIG_FILE="$HOME/.docker/config.json"

    TEMP=/tmp
    if is_windows; then
        # We need to use a directory that exists on the Win32 filesystem
        # so the ctrctl clients can correctly map the bind mounts.
        TEMP="$(win32env TEMP)"
    fi

    AUTH_DIR="$TEMP/auth"
    CAROOT="$TEMP/caroot"
    CERTS_DIR="$TEMP/certs"

    AUTH_DIR_VOLUME="$AUTH_DIR"
    CERTS_DIR_VOLUME="$CERTS_DIR"
    if using_windows_exe; then
        mkdir -p "$AUTH_DIR_VOLUME"
        mkdir -p "$CERTS_DIR_VOLUME"
        AUTH_DIR_VOLUME="$(wslpath -w "$AUTH_DIR_VOLUME")"
        CERTS_DIR_VOLUME="$(wslpath -w "$CERTS_DIR_VOLUME")"
    fi

    if is_windows && using_docker; then
        # BUG BUG BUG
        # docker service on Windows cannot be restarted, so we can't register
        # a new CA. `localhost` is an insecure registry, not requiring certs.
        # https://github.com/rancher-sandbox/rancher-desktop/issues/3878
        # BUG BUG BUG
        REGISTRY_HOST="localhost"
    else
        if is_windows; then
            # In WSL all distros have the same IP address
            ipaddr="$(ip a show eth0 | awk '/inet / {sub("/.*",""); print $2}')"
        else
            # Lima uses a fixed hard-coded IP address
            ipaddr="192.168.5.15"
        fi
        REGISTRY_HOST="registry.$ipaddr.sslip.io"
    fi
    REGISTRY="$REGISTRY_HOST:$REGISTRY_PORT"
}

create_registry() {
    run ctrctl rm -f registry
    assert_nothing
    ctrctl run \
        --detach \
        --name registry \
        --restart always \
        -p "$REGISTRY_PORT:$REGISTRY_PORT" \
        -e "REGISTRY_HTTP_ADDR=0.0.0.0:$REGISTRY_PORT" \
        -v "$CERTS_DIR_VOLUME:/certs" \
        -e "REGISTRY_HTTP_TLS_CERTIFICATE=/certs/$REGISTRY_HOST.pem" \
        -e "REGISTRY_HTTP_TLS_KEY=/certs/$REGISTRY_HOST-key.pem" \
        "$@" \
        "$REGISTRY_IMAGE"
    wait_for_registry
}

wait_for_registry() {
    # registry port is forwarded to host
    try --max 10 --delay 5 curl -k --silent --show-error "https://localhost:$REGISTRY_PORT/v2/_catalog"
    assert_success
}

using_insecure_registry() {
    [ "$REGISTRY_HOST" = "localhost" ]
}

skip_for_insecure_registry() {
    if using_insecure_registry; then
        skip "BUG: docker on Windows can only use insecure registry"
    fi
}

@test 'factory reset' {
    factory_reset
    rm -f "$DOCKER_CONFIG_FILE"
}

@test 'start container engine' {
    start_container_engine

    if using_image_allow_list; then
        wait_for_shell
        update_allowed_patterns true "$(printf '"%s" "docker.io/registry"' "$REGISTRY")"
    fi
}

@test 'wait for container engine' {
    wait_for_container_engine
}

@test 'verify credential is set correctly' {
    verify_default_credStore
}

verify_default_credStore() {
    local CREDHELPER_NAME="$(basename "$CRED_HELPER" .exe | sed s/^docker-credential-//)"
    run jq -r .credsStore "$DOCKER_CONFIG_FILE"
    assert_success
    assert_output "$CREDHELPER_NAME"
}

@test 'verify allowed-images config' {
    run ctrctl pull --quiet busybox
    if using_image_allow_list; then
        assert_failure
        assert_output --regexp "(unauthorized|Forbidden)"
    else
        assert_success
    fi
}

@test 'create server certs for registry' {
    rdsudo apk add mkcert --force-broken-world --repository https://dl-cdn.alpinelinux.org/alpine/edge/testing
    rdshell mkdir -p "$CAROOT"
    rdshell "CAROOT=$CAROOT" TRUST_STORES=none mkcert -install
    rdshell sh -c "mkdir -p \"$CERTS_DIR\"; cd \"$CERTS_DIR\"; CAROOT=\"$CAROOT\" mkcert \"$REGISTRY_HOST\""
}

@test 'pull registry image' {
    ctrctl pull --quiet "$REGISTRY_IMAGE"
}

@test 'create plain registry' {
    create_registry
}

@test 'tag image with registry' {
    ctrctl tag "$REGISTRY_IMAGE" "$REGISTRY/$REGISTRY_IMAGE"
}

@test 'expect push image to registry to fail because CA cert has not been installed' {
    skip_for_insecure_registry

    run ctrctl push "$REGISTRY/$REGISTRY_IMAGE"
    assert_failure
    # we don't get cert errors when going through the proxy; they turn into 502's
    assert_output --regexp "(certificate signed by unknown authority|502 Bad Gateway)"
}

@test 'install CA cert' {
    skip_for_insecure_registry

    rdsudo cp "$CAROOT/rootCA.pem" /usr/local/share/ca-certificates/
    rdsudo update-ca-certificates
}

@test 'restart container engine to refresh certs' {
    skip_for_insecure_registry

    rc_service "$CONTAINER_ENGINE_SERVICE" restart
    rc_service --ifstarted openresty restart
    wait_for_container_engine
    # when Moby is stopped, the containers are stopped as well
    if using_docker; then
        wait_for_registry
    fi
}

@test 'expect push image to registry to succeed now' {
    ctrctl push "$REGISTRY/$REGISTRY_IMAGE"
}

@test 'create registry with basic auth' {
    # note: docker htpasswd **must** use bcrypt algorithm, i.e. `htpasswd -nbB user password`
    # We intentionally use single-quotes; the '$' characters are literals
    # shellcheck disable=SC2016
    HTPASSWD='user:$2y$05$pd/kWjYSW9x48yaPQgrl.eLn02DdMPyoYPUy/yac601k6w.okKgmG'
    rdshell mkdir -p "$AUTH_DIR"
    echo "$HTPASSWD" | rdshell tee "$AUTH_DIR/htpasswd" >/dev/null
    create_registry \
        -v "$AUTH_DIR_VOLUME:/auth" \
        -e REGISTRY_AUTH=htpasswd \
        -e REGISTRY_AUTH_HTPASSWD_PATH=/auth/htpasswd \
        -e REGISTRY_AUTH_HTPASSWD_REALM="Registry Realm"
}

@test 'verify that registry requires basic auth' {
    local curl_options=(--silent --show-error)
    if using_insecure_registry; then
        curl_options+=(--insecure)
    fi

    local registry_url="https://$REGISTRY/v2/_catalog"
    run rdshell curl "${curl_options[@]}" "$registry_url"
    assert_success
    assert_output --partial '"message":"authentication required"'

    run rdshell curl "${curl_options[@]}" --user user:password "$registry_url"
    assert_success
    assert_output '{"repositories":[]}'
}

@test 'verify that pushing fails when not logged in' {
    run bash -c "echo \"$REGISTRY\" | \"$CRED_HELPER\" erase"
    assert_nothing
    run ctrctl push "$REGISTRY/$REGISTRY_IMAGE"
    assert_failure
    assert_output --regexp "(401 Unauthorized|no basic auth credentials)"
}

@test 'verify that pushing succeeds after logging in' {
    run ctrctl login -u user -p password "$REGISTRY"
    assert_success
    assert_output --partial "Login Succeeded"

    ctrctl push "$REGISTRY/$REGISTRY_IMAGE"
}

@test 'verify credentials in host cred store' {
    run bash -c "echo \"$REGISTRY\" | \"$CRED_HELPER\" get"
    assert_success
    assert_output --partial '"Secret":"password"'

    ctrctl logout "$REGISTRY"
    run bash -c "echo \"$REGISTRY\" | \"$CRED_HELPER\" get"
    refute_output --partial '"Secret":"password"'
}

@test 'verify the docker-desktop credential helper is replaced with the rancher-desktop default' {
    factory_reset
    echo '{ "credsStore": "desktop" }' >|"$DOCKER_CONFIG_FILE"
    start_container_engine
    wait_for_container_engine
    verify_default_credStore
}
