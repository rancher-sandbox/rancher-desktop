# bats file_tags=opensuse

load '../helpers/load'

local_setup() {
    TESTDATA_DIR="${PATH_BATS_ROOT}/tests/compose/testdata/"
    TESTDATA_DIR_HOST=$(host_path "$TESTDATA_DIR")
}

@test 'factory reset' {
    factory_reset
}

@test 'start container engine' {
    start_container_engine
    wait_for_container_engine
}

@test 'compose up' {
    ctrctl compose --project-directory "$TESTDATA_DIR_HOST" build \
        --build-arg IMAGE_NGINX="$IMAGE_NGINX" \
        --build-arg IMAGE_PYTHON="$IMAGE_PYTHON_3_9_SLIM"
    ctrctl compose --project-directory "$TESTDATA_DIR_HOST" up -d --no-build
}

verify_running_container() {
    try --max 9 --delay 10 curl --silent --show-error "$1"
    assert_success
    assert_output --partial "$2"
}

@test 'verify app bound to localhost' {
    verify_running_container "http://localhost:8080" "Welcome to nginx!"
    skip_unless_host_ip
    run curl --verbose --head "http://${HOST_IP}:8080"
    assert_output --partial "curl: (7) Failed to connect"
}

@test 'verify app bound to wildcard IP' {
    local expected_output="Hello World!"
    verify_running_container "http://localhost:8000" "$expected_output"
    skip_unless_host_ip
    verify_running_container "http://${HOST_IP}:8000" "$expected_output"
}

@test 'verify connectivity via host.docker.internal' {
    local expected_output="Hello World!"
    verify_running_container "http://localhost:8080/app" "$expected_output"
}

@test 'compose down' {
    run ctrctl compose --project-directory "$TESTDATA_DIR_HOST" down
    assert_success
}
