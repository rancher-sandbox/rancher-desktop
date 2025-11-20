# bats file_tags=opensuse

load '../helpers/load'

@test 'factory reset' {
    factory_reset
}

@test 'start container engine' {
    start_container_engine
    wait_for_container_engine
}

run_container_with_published_port() {
    ctrctl pull --quiet "$IMAGE_NGINX"
    ctrctl run -d -p "$@" --restart=no "$IMAGE_NGINX"
}

verify_container_published_port() {
    run try --max 9 --delay 10 curl --insecure --verbose --show-error "$@"
    assert_success
    assert_output --partial 'Welcome to nginx!'
}

@test 'container published port binding to localhost' {
    run_container_with_published_port "127.0.0.1:8080:80"
    verify_container_published_port "http://127.0.0.1:8080"
}

@test 'container published port binding to localhost should not be accessible via 0.0.0.0' {
    skip_unless_host_ip
    run curl --verbose --head "http://${HOST_IP}:8080"
    assert_output --partial "curl: (7) Failed to connect"
}

@test 'container published port binding to 0.0.0.0' {
    skip_unless_host_ip
    run_container_with_published_port "8081:80"
    verify_container_published_port "http://${HOST_IP}:8081"
}
