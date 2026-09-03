load '../helpers/load'

local_setup() {
    if ! using_docker; then
        skip "dangling image records only occur in the moby containerd image store"
    fi
}

# k3s backported the switch to the OCI archive layout across its branches, so
# no version comparison tells us whether this archive has an index.json to
# filter; only the archive itself does.
skip_unless_loader_can_filter() {
    run -0 --separate-stderr ctrctl info --format '{{.Driver}}'
    if [[ ${output} != "overlayfs" ]]; then
        skip "the classic image store (${output}) loads every image"
    fi
    # Both guests install GNU tar, which reads the .tar.zst that k3sHelper
    # prefers over the plain .tar. Listing into a variable first keeps a tar
    # failure out of the count, where it would read as an archive with no index.
    # shellcheck disable=SC2016 # the guest shell expands these, not this one
    local probe='
        set -o errexit
        for archive in /var/lib/rancher/k3s/agent/images/k3s-airgap-images-*.tar.zst \
            /var/lib/rancher/k3s/agent/images/k3s-airgap-images-*.tar; do
            if [ -f "$archive" ]; then break; fi
        done
        members=$(tar -tf "$archive")
        printf "%s\n" "$members" | grep -c "^index.json$" || true
    '
    run -0 --separate-stderr rdsudo sh -c "$probe"
    assert_output --regexp '^[0-9]+$'
    if [[ ${output} == "0" ]]; then
        skip "this k3s airgap archive has no index.json to filter"
    fi
}

# A redundant load leaves a moby-dangling@<digest> record beside the tag it
# duplicates, which dockerd logs on every inspect.
assert_no_dangling_records() {
    skip_unless_loader_can_filter
    if is_windows; then
        # On WSL dockerd logs to the host log directory instead of /var/log.
        refute_file_contains "$PATH_LOGS/docker.log" 'still dangling'
    else
        # rdctl collapses any remote failure to status 1 with nothing on
        # stdout, which is also what a grep that matched nothing returns.
        # Counting matches makes the count itself proof that the grep ran.
        run -0 --separate-stderr rdsudo sh -c "grep -c 'still dangling' /var/log/docker.log || true"
        assert_output '0'
    fi
}

@test 'factory reset' {
    factory_reset
}

@test 'start rancher desktop with kubernetes enabled' {
    start_kubernetes
    wait_for_kubelet
    wait_for_service_status k3s started
}

# The k3s init script loads the airgap images from start_pre, on every start.
@test 'restart kubernetes to load the airgap images again' {
    rdctl set --kubernetes.enabled=false
    wait_for_service_status k3s stopped
    rdctl set --kubernetes.enabled=true
    wait_for_kubelet
    wait_for_service_status k3s started
}

@test 'the airgap images are loaded' {
    run -0 ctrctl images --format '{{.Repository}}'
    assert_line --partial 'rancher/mirrored-pause'
}

@test 'no image has a dangling duplicate' {
    assert_no_dangling_records
}

# Removing one image makes the next start filter index.json down to that image
# and repack the archive. A filter that emits invalid JSON fails "docker load",
# and the k3s start_pre with it.
@test 'removing one image reloads only that image' {
    skip_unless_loader_can_filter

    run -0 --separate-stderr ctrctl images --format '{{.Repository}}:{{.Tag}}'
    assert_output --partial 'rancher/'

    local removed=""
    for image in "${lines[@]}"; do
        # Most of these images back a running pod, and those cannot be removed.
        if ctrctl rmi "$image" >/dev/null 2>&1; then
            removed=$image
            break
        fi
    done
    if [[ -z ${removed} ]]; then
        fail "could not remove any of the ${#lines[@]} images"
    fi

    rdctl set --kubernetes.enabled=false
    wait_for_service_status k3s stopped
    rdctl set --kubernetes.enabled=true
    wait_for_kubelet
    wait_for_service_status k3s started

    run -0 --separate-stderr ctrctl images --format '{{.Repository}}:{{.Tag}}'
    assert_line "$removed"
}

@test 'the partial load leaves no dangling duplicate' {
    assert_no_dangling_records
}
