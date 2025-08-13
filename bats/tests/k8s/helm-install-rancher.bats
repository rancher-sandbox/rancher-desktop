# Test case 11 & 12
# bats file_tags=opensuse

load '../helpers/load'
RD_FILE_RAMDISK_SIZE=12 # We need more disk to run the Rancher image.

local_setup() {
    needs_port 443
}

# Check that the rancher-latest/rancher helm chart at the given version is
# supported on the current Kubernetes version (as determined by
# $RD_KUBERNETES_VERSION)
is_rancher_chart_compatible() {
    local chart_version=$1

    run helm show chart rancher-latest/rancher --version "$chart_version"
    assert_success || return

    run awk '/^kubeVersion:/ { $1 = ""; print }' <<<"$output"
    assert_success || return
    # We only support kubeVersion of form "< x.y.z"
    assert_output --regexp '^[[:space:]]*<[[:space:]]*[^[:space:]]+$' || return

    run awk '{ print $2 }' <<<"$output"
    assert_success || return

    local unsupported_version=$output
    semver_gt "$unsupported_version" "$RD_KUBERNETES_VERSION" || return
}

# Set (and save) $rancher_chart_version to $RD_RANCHER_IMAGE_TAG if it is set
# (and compatible), or otherwise the oldest chart version that supports
# $RD_KUBERNETES_VERSION.
# If no compatible chart version could be found, calls mark_k3s_version_skipped
# and fails the test.
determine_chart_version() {
    local rancher_chart_version
    if [[ -n $RD_RANCHER_IMAGE_TAG ]]; then
        # If a version is given, check that it's compatible.
        rancher_chart_version=${RD_RANCHER_IMAGE_TAG#v}
        if ! is_rancher_chart_compatible "$rancher_chart_version"; then
            mark_k3s_version_skipped
            printf "Rancher %s is not compatible with Kubernetes %s" \
                "$rancher_chart_version" "$RD_KUBERNETES_VERSION" |
                fail
            return
        fi
        save_var rancher_chart_version
        return
    fi
    local default_version
    default_version=$(rancher_image_tag)
    default_version=${default_version#v}

    run --separate-stderr helm search repo --versions rancher-latest/rancher --output json
    assert_success || return

    run jq_output 'map(.version).[]'
    assert_success || return

    run sort --version-sort <<<"$output"
    assert_success || return
    local versions=$output

    for rancher_chart_version in $versions; do
        if ! semver_is_valid "$rancher_chart_version"; then
            continue # Skip invalid / RC versions.
        fi
        if semver_lt "$rancher_chart_version" "$default_version"; then
            continue # Skip any versions older than the default version
        fi
        if is_rancher_chart_compatible "$rancher_chart_version"; then
            # Once we find a compatible version, use it (and don't look at the
            # rest of the chart versions).
            trace "$(printf "Selected rancher chart version %s for Kubernetes %s" \
                "$rancher_chart_version" "$RD_KUBERNETES_VERSION")"
            save_var rancher_chart_version
            return
        fi
    done
    mark_k3s_version_skipped
    printf "Could not find a version of rancher-latest/rancher compatible with Kubernetes %s\n" \
        "$RD_KUBERNETES_VERSION" |
        fail || return
}

deploy_rancher() {
    # TODO remove `skip_unless_host_ip` once `traefik_hostname` no longer needs it
    if is_windows; then
        skip_unless_host_ip
    fi

    local rancher_chart_version
    if ! load_var rancher_chart_version; then
        fail "Could not restore Rancher chart version"
    fi

    helm upgrade \
        --install cert-manager jetstack/cert-manager \
        --namespace cert-manager \
        --set installCRDs=true \
        --set "extraArgs[0]=--enable-certificate-owner-ref=true" \
        --create-namespace

    local host
    host=$(traefik_hostname) || return

    comment "Installing rancher $rancher_chart_version"
    helm upgrade \
        --install rancher rancher-latest/rancher \
        --version "$rancher_chart_version" \
        --namespace cattle-system \
        --set hostname="$host" \
        --wait \
        --timeout=10m \
        --create-namespace
}

verify_rancher() {
    # TODO remove `skip_unless_host_ip` once `traefik_hostname` no longer needs it
    if is_windows; then
        skip_unless_host_ip
    fi

    local host
    host=$(traefik_hostname) || return

    run try --max 9 --delay 10 curl --insecure --silent --show-error "https://${host}/dashboard/auth/login"
    assert_success
    assert_output --partial 'src="/dashboard/'
    run kubectl get secret --namespace cattle-system bootstrap-secret -o json
    assert_success
    assert_output --partial "bootstrapPassword"
}

uninstall_rancher() {
    run helm uninstall rancher --namespace cattle-system --wait
    assert_nothing
    run helm uninstall cert-manager --namespace cert-manager --wait
    assert_nothing
}

@test 'add helm repo' {
    helm repo add jetstack https://charts.jetstack.io
    helm repo add rancher-latest https://releases.rancher.com/server-charts/latest
    helm repo update
}

foreach_k3s_version \
    determine_chart_version \
    factory_reset \
    start_kubernetes \
    wait_for_kubelet \
    wait_for_traefik \
    deploy_rancher \
    verify_rancher \
    uninstall_rancher
