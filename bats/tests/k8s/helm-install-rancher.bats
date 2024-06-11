# Test case 11 & 12

load '../helpers/load'
RD_FILE_RAMDISK_SIZE=12 # We need more disk to run the Rancher image.

local_setup() {
    needs_port 443
}

@test 'add helm repo' {
    helm repo add jetstack https://charts.jetstack.io
    helm repo add rancher-latest https://releases.rancher.com/server-charts/latest
    helm repo update
}

# Get the minimum Kubernetes version the given rancher-latest/rancher helm chart
# does _not_ support; i.e. the chart supports < [output].
get_chart_unsupported_version() {
    output="" # Hack: tell shellcheck about this variable
    local chart_version=$1
    run helm show chart rancher-latest/rancher --version "$chart_version"
    assert_success || return
    run awk '/^kubeVersion:/ { $1 = ""; print }' <<<"$output"
    assert_success || return
    # We only support kubeVersion of form "< x.y.z"
    assert_output --regexp '^[[:space:]]*<[[:space:]]*[^[:space:]]+$' || return
    awk '{ print $2 }' <<<"$output"
}

# Try to determine the best chart version for the current Kubernetes version
# (as specified in $RD_KUBERNETES_PREV_VERSION).  Saves the resulting version
# in rancher_chart_version (and should be restored via load_var).
determine_chart_version() {
    if [[ -n $RD_RANCHER_IMAGE_TAG ]]; then
        # If a version is given, check that it's compatible.
        assert_rancher_chart_compatible "${RD_RANCHER_IMAGE_TAG#v}" || return
        rancher_chart_version=${RD_RANCHER_IMAGE_TAG#v}
        save_var rancher_chart_version
        return
    fi
    local default_version
    default_version=$(rancher_image_tag)
    default_version=${default_version#v}
    run --separate-stderr helm search repo --versions rancher-latest/rancher --output json
    assert_success || return
    local versions_json=$output
    run jq_output 'map(.version).[]'
    assert_success || return
    run sort --version-sort <<<"$output"
    assert_success || return
    local versions=$output
    local version
    for version in $versions; do
        if ! semver_is_valid "$version"; then
            continue # Skip invalid / RC versions.
        fi
        if semver_lt "$version" "$default_version"; then
            continue # Skip any versions older than the default version
        fi
        run get_chart_unsupported_version "$version"
        assert_success || return
        local unsupported_version=$output
        if semver_lt "$RD_KUBERNETES_PREV_VERSION" "$unsupported_version"; then
            # Once we find a compatible version, use it (and don't look at the
            # rest of the chart versions).
            trace "$(printf "Selected rancher chart version %s (wants < %s, have %s)" \
                "$version" "$unsupported_version" "$RD_KUBERNETES_PREV_VERSION")"
            rancher_chart_version=$version
            save_var rancher_chart_version
            return
        fi
    done
    skip_k3s_version
    printf "Could not find a version of rancher-latest/rancher compatible with Kubernetes %s\n" \
        "$RD_KUBERNETES_PREV_VERSION" |
        fail || return
}

# Check that the rancher-latest/rancher helm chart at the given version is
# supported on the current Kubernetes version (as determined by $RD_KUBERNETES_PREV_VERSION)
assert_rancher_chart_compatible() {
    local chart_version=$1
    run get_chart_unsupported_version "$chart_version"
    assert_success || return
    local unsupported_version=$output
    if semver_lte "$unsupported_version" "$RD_KUBERNETES_PREV_VERSION"; then
        skip_k3s_version
        printf "Rancher %s wants Kubernetes < %s, have %s" \
            "$chart_version" "$unsupported_version" "$RD_KUBERNETES_PREV_VERSION" |
            fail || return
    fi
    trace "Chart $chart_version < $unsupported_version good for $RD_KUBERNETES_PREV_VERSION"
}

deploy_rancher() {
    # TODO remove `skip_unless_host_ip` once `traefik_hostname` no longer needs it
    if is_windows; then
        skip_unless_host_ip
    fi

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

    helm upgrade \
        --install rancher rancher-latest/rancher \
        --version "${rancher_chart_version}" \
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
    assert_output --partial 'href="/dashboard/'
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

foreach_k3s_version \
    factory_reset \
    determine_chart_version \
    start_kubernetes \
    wait_for_kubelet \
    wait_for_traefik \
    deploy_rancher \
    verify_rancher \
    uninstall_rancher
