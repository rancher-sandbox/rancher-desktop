# Test case 20

setup() {
    load '../helpers/load'
}

@test 'factory reset' {
    factory_reset
}

@test 'start container engine' {
    start_container_engine
    wait_for_container_engine
}

@test "verify we're on docker" {
    engineName="$(rdctl list-settings | jq -r .containerEngine.name)"
    case $engineName in
    containerd)
        rdctl set --container-engine.name moby
        wait_for_container_engine
        ;;
    esac
}

@test "pull rancher" {
    docker run --privileged -d --restart=no -p 8080:80 -p 8443:443 rancher/rancher
    run docker ps --format '{{json .Image}}'
    assert_output --partial "rancher/rancher"
}

@test "switch to containerd" {
    rdctl set --container-engine.name=containerd
    wait_for_container_engine
    nerdctl run --privileged -d --restart=no -p 8080:80 -p 8443:443 rancher/rancher
    run nerdctl ps --format '{{json .Image}}'
    assert_output --partial "rancher/rancher"
}

@test 'switch back to moby' {
    rdctl set --container-engine.name moby
    wait_for_container_engine
}

@test 'verify the rancher container is gone' {
    run docker ps --format '{{json .Image}}'
    refute_output --partial "rancher/rancher"
}

@test 'switch back to containerd and verify that container is gone' {
    rdctl set --container-engine.name containerd
    run nerdctl ps --format '{{json .Image}}'
    refute_output --partial "rancher/rancher"
}
