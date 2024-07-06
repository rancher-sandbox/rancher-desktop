# shellcheck disable=SC2059
# https://www.shellcheck.net/wiki/SC2059 -- Don't use variables in the printf format string. Use printf '..%s..' "$foo".
# This file exists to print information about the configuration.

show_info() { # @test
    # In case the file is loaded as a test: bats tests/helpers/info.bash
    if [ -z "$RD_HELPERS_LOADED" ]; then
        load load.bash
    fi

    if capturing_logs || taking_screenshots; then
        rm -rf "$PATH_BATS_LOGS"
    fi

    if is_false "${RD_INFO:-true}"; then
        return
    fi

    (
        local format="# %s | %s\n"

        printf "$format" "Install location:" "$RD_LOCATION"
        printf "$format" "Resources path:" "$PATH_RESOURCES"
        echo "#"
        printf "$format" "Container engine:" "$RD_CONTAINER_ENGINE"
        printf "$format" "Kubernetes version:" "$RD_KUBERNETES_VERSION ($RD_K3S_VERSIONS)"
        printf "$format" "Mount type:" "$RD_MOUNT_TYPE"
        if [ "$RD_MOUNT_TYPE" = "9p" ]; then
            printf "$format" "  9p cache mode:" "$RD_9P_CACHE_MODE"
            printf "$format" "  9p msize:" "$RD_9P_MSIZE"
            printf "$format" "  9p protocol version:" "$RD_9P_PROTOCOL_VERSION"
            printf "$format" "  9p security model:" "$RD_9P_SECURITY_MODEL"
        fi
        printf "$format" "Using image allow list:" "$(bool using_image_allow_list)"
        if is_macos; then
            printf "$format" "Using VZ emulation:" "$(bool using_vz_emulation)"
            printf "$format" "Using ramdisk:" "$(bool using_ramdisk)"
        fi
        if is_windows; then
            printf "$format" "Using Windows executables:" "$(bool using_windows_exe)"
            printf "$format" "Using networking tunnel:" "$(bool using_networking_tunnel)"
        fi
        echo "#"
        printf "$format" "Capturing logs:" "$(bool capturing_logs)"
        printf "$format" "Tracing execution:" "$(bool is_true "$RD_TRACE")"
        printf "$format" "Taking screenshots:" "$(bool taking_screenshots)"
        printf "$format" "Using ghcr.io images:" "$(bool using_ghcr_images)"
    ) | column -t -s '|' >&3
}
