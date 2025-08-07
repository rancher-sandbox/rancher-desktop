load '../helpers/load'

local_setup() {
    REGISTRY_PORT="5050"
    if is_windows && ! using_windows_exe; then
        # TODO TODO TODO
        # RD will only modify the Windows version of .docker/config.json;
        # there is no WSL integration support for it. Therefore this test
        # always needs to modify the Windows version and not touch the
        # Linux one. This may change depending on:
        # https://github.com/rancher-sandbox/rancher-desktop/issues/5523
        # TODO TODO TODO
        USERPROFILE="$(wslpath_from_win32_env USERPROFILE)"
    fi
    DOCKER_CONFIG_FILE="$USERPROFILE/.docker/config.json"

    TEMP=/tmp
    if is_windows; then
        # We need to use a directory that exists on the Win32 filesystem
        # so the ctrctl clients can correctly map the bind mounts.
        # We can use host_path() on these paths because they will exist
        # both here and in the rancher-desktop distro.
        TEMP="$(wslpath_from_win32_env TEMP)"
    fi

    AUTH_DIR="$TEMP/auth"
    CAROOT="$TEMP/caroot"
    CERTS_DIR="$TEMP/certs"

    if is_windows && using_docker; then
        # BUG BUG BUG
        # docker service on Windows cannot be restarted, so we can't register
        # a new CA. `localhost` is an insecure registry, not requiring certs.
        # https://github.com/rancher-sandbox/rancher-desktop/issues/3878
        # BUG BUG BUG
        REGISTRY_HOST="localhost"
    else
        # Determine IP address of the VM that is routable inside the VM itself.
        # Essentially localhost, but needs to be a routable IP that also works
        # from inside a container. Will be turned into a DNS name using sslip.io.
        if is_windows; then
            ipaddr="192.168.143.1"
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
    rdshell mkdir -p "$CERTS_DIR"
    ctrctl run \
        --detach \
        --name registry \
        --restart always \
        -p "$REGISTRY_PORT:$REGISTRY_PORT" \
        -e "REGISTRY_HTTP_ADDR=0.0.0.0:$REGISTRY_PORT" \
        -v "$(host_path "$CERTS_DIR"):/certs" \
        -e "REGISTRY_HTTP_TLS_CERTIFICATE=/certs/$REGISTRY_HOST.pem" \
        -e "REGISTRY_HTTP_TLS_KEY=/certs/$REGISTRY_HOST-key.pem" \
        "$@" \
        "$IMAGE_REGISTRY"
    wait_for_registry
}

wait_for_registry() {
    trace "$(ctrctl ps -a)"
    # registry port is forwarded to host
    try --max 20 --delay 5 curl -k --silent --show-error "https://localhost:$REGISTRY_PORT/v2/_catalog"
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

    wait_for_shell
    for dir in "$AUTH_DIR" "$CAROOT" "$CERTS_DIR"; do
        rdshell rm -rf "$dir"
    done

    if using_image_allow_list; then
        update_allowed_patterns true "$IMAGE_REGISTRY" "$REGISTRY"
    fi
}

@test 'wait for container engine' {
    wait_for_container_engine
}

@test 'verify credential is set correctly' {
    verify_default_credStore
}

verify_default_credStore() {
    local CREDHELPER_NAME
    CREDHELPER_NAME="$(basename "$CRED_HELPER" .exe | sed s/^docker-credential-//)"
    run jq --raw-output .credsStore "$DOCKER_CONFIG_FILE"
    assert_success
    assert_output "$CREDHELPER_NAME"
}

@test 'verify allowed-images config' {
    run ctrctl pull --quiet "$IMAGE_BUSYBOX"
    if using_image_allow_list; then
        assert_failure
        assert_output --regexp "(UNAUTHORIZED|Forbidden)"
    else
        assert_success
    fi
}

@test 'create server certs for registry' {
    rdsudo apk add mkcert --force-broken-world --repository https://dl-cdn.alpinelinux.org/alpine/edge/testing
    rdshell mkdir -p "$CAROOT" "$CERTS_DIR"
    rdshell sh -c "CAROOT=\"$CAROOT\" TRUST_STORES=none mkcert -install"
    rdshell sh -c "cd \"$CERTS_DIR\"; CAROOT=\"$CAROOT\" mkcert \"$REGISTRY_HOST\""
}

@test 'pull registry image' {
    ctrctl pull --quiet "$IMAGE_REGISTRY"
}

@test 'create plain registry' {
    create_registry
}

@test 'tag image with registry' {
    ctrctl tag "$IMAGE_REGISTRY" "$REGISTRY/registry"
}

@test 'expect push image to registry to fail because CA cert has not been installed' {
    skip_for_insecure_registry

    run ctrctl push "$REGISTRY/registry"
    assert_failure
    # we don't get cert errors when going through the proxy; they turn into 502's
    assert_output --regexp "(certificate signed by unknown authority|502 Bad Gateway)"
}

@test 'install CA cert' {
    skip_for_insecure_registry

    rdsudo cp "$CAROOT/rootCA.pem" /usr/local/share/ca-certificates/
    rdsudo update-ca-certificates
}

restart_container_engine() {
    # BUG BUG BUG
    # When using containerd, sometimes the container would get wedged on a
    # restart; however, restarting containerd again seems to fix this.
    # So we need to keep trying until the registry container is not `created`.
    # BUG BUG BUG
    service_control "$CONTAINER_ENGINE_SERVICE" restart || return

    service_control --ifstarted rd-openresty restart || return

    wait_for_container_engine || return

    trace "$(ctrctl ps -a)"
    if using_containerd; then
        run ctrctl ps --filter status=created,name=registry --format '{{.Names}}'
        assert_success || return
        refute_output registry || return
    fi
}

@test 'restart container engine to refresh certs' {
    skip_for_insecure_registry

    # BUG BUG BUG
    # When using containerd the guestagent currently doesn't enumerate
    # running containers when it starts up to find existing open ports
    # (it does this for moby only). Therefore it misses forwarding
    # ports that have been opened while the guestagent was down.
    #
    # The guestagent would restart automatically when containerd
    # restart. By explicitly stopping/restarting the guestagent we are
    # more likely to have the new instance running by the time the
    # containerd becomes ready.
    #
    # This workaround can be removed when the following bug has been fixed:
    # https://github.com/rancher-sandbox/rancher-desktop/issues/7146
    # BUG BUG BUG
    if is_windows && using_containerd; then
        service_control rancher-desktop-guestagent stop
    fi

    try restart_container_engine

    # BUG BUG BUG
    # Second part of the guestagent workaround; see the block about
    # https://github.com/rancher-sandbox/rancher-desktop/issues/7146
    # BUG BUG BUG
    if is_windows && using_containerd; then
        service_control rancher-desktop-guestagent start
    fi

    wait_for_registry
}

@test 'expect push image to registry to succeed now' {
    ctrctl push "$REGISTRY/registry"
}

@test 'create registry with basic auth' {
    # note: docker htpasswd **must** use bcrypt algorithm, i.e. `htpasswd -nbB user password`
    # We intentionally use single-quotes; the '$' characters are literals
    # shellcheck disable=SC2016
    HTPASSWD='user:$2y$05$pd/kWjYSW9x48yaPQgrl.eLn02DdMPyoYPUy/yac601k6w.okKgmG'
    rdshell mkdir -p "$AUTH_DIR"
    echo "$HTPASSWD" | rdshell tee "$AUTH_DIR/htpasswd" >/dev/null
    create_registry \
        -v "$(host_path "$AUTH_DIR"):/auth" \
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
    run ctrctl push "$REGISTRY/registry"
    assert_failure
    assert_output --regexp "(401 Unauthorized|no basic auth credentials)"
}

@test 'verify that pushing succeeds after logging in' {
    run ctrctl login -u user -p password "$REGISTRY"
    assert_success
    assert_output --partial "Login Succeeded"

    ctrctl push "$REGISTRY/registry"
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
