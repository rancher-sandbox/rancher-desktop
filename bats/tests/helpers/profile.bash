case $OS in
darwin)
    PROFILE_SYSTEM_DEFAULTS=/Library/Preferences/io.rancherdesktop.profile.defaults.plist
    PROFILE_SYSTEM_LOCKED=/Library/Preferences/io.rancherdesktop.profile.locked.plist
    PROFILE_USER_DEFAULTS="${HOME}${PROFILE_SYSTEM_DEFAULTS}"
    PROFILE_USER_LOCKED="${HOME}${PROFILE_SYSTEM_LOCKED}"
    ;;
linux)
    PROFILE_SYSTEM_DEFAULTS=/etc/rancher-desktop/defaults.json
    PROFILE_SYSTEM_LOCKED=/etc/rancher-desktop/locked.json
    PROFILE_USER_DEFAULTS="${HOME}/.config/rancher-desktop.defaults.json"
    PROFILE_USER_LOCKED="${HOME}/.config/rancher-desktop.locked.json"
    ;;
windows)
    PROFILE='Software\Policies\Rancher Desktop'
    PROFILE_SYSTEM_DEFAULTS="HKLM\\${PROFILE}\\Defaults"
    PROFILE_SYSTEM_LOCKED="HKLM\\${PROFILE}\\Locked"
    PROFILE_USER_DEFAULTS="HKCU\\${PROFILE}\\Defaults"
    PROFILE_USER_LOCKED="HKCU\\${PROFILE}\\Locked"

    # The legacy profiles (for both system and user) are supported for backward
    # compatibility with Rancher Desktop 1.8.x. For BATS purposes the legacy
    # user profiles have the advantage of being writable without admin rights.
    PROFILE='Software\Rancher Desktop\Profile'
    PROFILE_SYSTEM_LEGACY_DEFAULTS="HKLM\\${PROFILE}\\Defaults"
    PROFILE_SYSTEM_LEGACY_LOCKED="HKLM\\${PROFILE}\\Locked"
    PROFILE_USER_LEGACY_DEFAULTS="HKCU\\${PROFILE}\\Defaults"
    PROFILE_USER_LEGACY_LOCKED="HKCU\\${PROFILE}\\Locked"
    ;;
esac

PROFILE_SYSTEM=system
PROFILE_SYSTEM_LEGACY=system-legacy
PROFILE_USER=user
PROFILE_USER_LEGACY=user-legacy

PROFILE_DEFAULTS=defaults
PROFILE_LOCKED=locked

# Default location is a writable user location
if is_windows; then
    PROFILE_LOCATION=$PROFILE_USER_LEGACY
else
    PROFILE_LOCATION=$PROFILE_USER
fi
PROFILE_TYPE=$PROFILE_DEFAULTS

# profile_location is a registry key on Windows, or a filename on macOS and Linux.
profile_location() {
    local profile
    profile=$(to_upper "profile_${PROFILE_LOCATION}_${PROFILE_TYPE}" | tr - _)
    echo "${!profile}"
}

# Execute command for each profile
foreach_profile() {
    local locations=("$PROFILE_SYSTEM" "$PROFILE_USER")
    if is_windows; then
        locations+=("$PROFILE_SYSTEM_LEGACY" "$PROFILE_USER_LEGACY")
    fi

    local PROFILE_LOCATION PROFILE_TYPE
    for PROFILE_LOCATION in "${locations[@]}"; do
        for PROFILE_TYPE in "$PROFILE_DEFAULTS" "$PROFILE_LOCKED"; do
            "$@"
        done
    done
}

# Check if profile exists
profile_exists() {
    case $OS in
    darwin | linux)
        [[ -f $(profile_location) ]]
        ;;
    windows)
        profile_reg query &>/dev/null
        ;;
    esac
}

# Create empty profile
create_profile() {
    case $OS in
    darwin)
        profile_plutil -create xml1
        ;;
    linux)
        local filename
        filename=$(profile_location)
        profile_sudo mkdir -p "$(dirname "$filename")"
        echo "{}" | profile_cat "$filename"
        ;;
    windows)
        # Make sure any old profile data at this location is removed
        run profile_reg delete "."
        assert_nothing
        # Create subkey so that profile_exists returns true now
        profile_reg add "."
        ;;
    esac
}

# Completely remove the profile. Ignores error if profile doesn't exist
delete_profile() {
    if deleting_profiles; then
        case $OS in
        darwin | linux)
            run profile_sudo rm -f "$(profile_location)"
            assert_nothing
            ;;
        windows)
            run profile_reg delete "."
            assert_nothing
            ;;
        esac
    fi
}

# Export/copy profile to a directory
export_profile() {
    local dir=$1
    if profile_exists; then
        local export="${dir}/profile.${PROFILE_LOCATION}.${PROFILE_TYPE}"
        case $OS in
        darwin | linux)
            local filename
            filename=$(profile_location)
            # Keep .plist or .json file extension
            cp "$filename" "${export}.${filename##*.}"
            ;;
        windows)
            export="$(wslpath -w "${export}.reg")"
            profile_reg export "${export}" /y
            ;;
        esac
    fi
}

# Add boolean setting; value must be "true" or "false"
add_profile_bool() {
    local setting=$1
    local value=$2

    case $OS in
    darwin)
        profile_plutil -replace "$setting" -bool "$value"
        ;;
    linux)
        profile_jq ".${setting} = ${value}"
        ;;
    windows)
        if [[ $value == true ]]; then
            profile_reg add "$setting" /t REG_DWORD /d 1
        else
            profile_reg add "$setting" /t REG_DWORD /d 0
        fi
        ;;
    esac
}

add_profile_int() {
    local setting=$1
    local value=$2

    case $OS in
    darwin)
        profile_plutil -replace "$setting" -integer "$value"
        ;;
    linux)
        profile_jq ".${setting} = ${value}"
        ;;
    windows)
        profile_reg add "$setting" /t REG_DWORD /d "$value"
        ;;
    esac
}

add_profile_string() {
    local setting=$1
    local value=$2

    case $OS in
    darwin)
        profile_plutil -replace "$setting" -string "$value"
        ;;
    linux)
        profile_jq ".${setting} = $(json_string "$value")"
        ;;
    windows)
        profile_reg add "$setting" /t REG_SZ /d "$value"
        ;;
    esac
}

add_profile_list() {
    local setting=$1
    shift

    local elem
    case $OS in
    darwin)
        profile_plutil -replace "$setting" -array
        for elem in "$@"; do
            profile_plutil -insert "$setting" -string "$elem" -append
        done
        ;;
    linux)
        profile_jq ".${setting} = []"
        for elem in "$@"; do
            profile_jq ".${setting} += [$(json_string "$elem")]"
        done
        ;;
    windows)
        # TODO: what happens when the values contain whitespace or quote characters?
        profile_reg add "$setting" /t REG_MULTI_SZ /d "$(join_map '\0' echo "$@")"
        ;;
    esac
}

# Remove a key or named value from the profile.
# Use a trailing dot to specify that the setting points to a key, e.g. "foo.bar.".
# It only makes a difference on Windows but will work on all platforms.
remove_profile_entry() {
    local setting=$1

    case $OS in
    darwin)
        profile_plutil -remove "${setting%.}" || return
        ;;
    linux)
        # This relies on `null` not being a valid setting value.
        profile_jq "
            if (try .${setting%.}) | type == \"null\" then
                error(\"setting ${setting%.} not found\")
            else
                del(.${setting%.})
            end
        " || return
        ;;
    windows)
        profile_reg delete "$setting" || return
        ;;
    esac
}

################################################################################
# functions defined below this line are implementation detail and should not
# be called directly from any tests.
################################################################################

# Returns number of setting segments (separated by dots), e.g. foo.bar.baz returns 3
count_setting_segments() {
    echo "${1//./$'\n'}" | wc -l
}

# Usage: profile_jq $expr
#
# Applies $expr against the profile and updates it in-places.
profile_jq() {
    local expr=$1
    local filename
    filename=$(profile_location)
    # Need to use a temp file to avoid truncating the file before it has been read.
    jq "$expr" "$filename" | profile_cat "${filename}.tmp"
    profile_sudo mv "${filename}.tmp" "$filename"
}

# Usage: profile_plutil $action $options
#
# For -insert|-replace|-remove actions it will make sure all higher level
# dictionaries are created first because plutil doesn't do it by itself.
profile_plutil() {
    local action=$1

    # Make sure all the dictionaries for the setting path exist
    if [[ $action =~ ^-insert|-replace|-remove$ ]]; then
        local setting=$2
        local count
        count=$(count_setting_segments "$setting")
        if ((count > 1)); then
            local index
            for index in $(seq $((count - 1))); do
                local keypath
                keypath=$(echo "$setting" | cut -d . -f 1-"$index")
                # Ignore error if dictionary already exists
                profile_sudo plutil -insert "$keypath" -dictionary "$(profile_location)" || :
            done
        fi
    fi

    profile_sudo plutil "$@" "$(profile_location)"
}

# Usage: profile_reg $action $options
#    or: profile_reg add|delete $setting $options
#
# Determines the $reg_key from both the profile_location() and the $setting.
# Setting `foo.bar.baz` means `foo\bar` is the reg_subkey, and `baz` is the value name.
#
# Special case `foo.bar.` is used only for "delete" action and specifies `foo\bar`
# as the subkey to be deleted (including all values under the key).
profile_reg() {
    local action=$1
    shift

    local reg_key
    reg_key=$(profile_location)
    if [[ $action =~ ^add|delete$ ]]; then
        local setting=$1
        shift

        local count
        count=$(count_setting_segments "$setting")
        if ((count > 1)); then
            local reg_subkey
            reg_subkey=$(echo "$setting" | cut -d . -f 1-"$((count - 1))")
            # reg_key uses backslashes instead of dot separators
            reg_key="${reg_key}\\${reg_subkey//./\\}"
        fi

        local reg_value_name
        reg_value_name=$(echo "$setting" | cut -d . -f "$count")
        # reg_value_name may be empty when deleting a registry key instead of a named value
        if [[ -n $reg_value_name ]]; then
            # turn protected dots back into regular dots again
            set - /v "${reg_value_name//$RD_PROTECTED_DOT/.}" "$@"
        fi

        # Delete entries (and overwrite existing ones) without prompt
        set - "$@" /f
    fi

    reg.exe "$action" "$reg_key" "$@"
}

profile_sudo() {
    # TODO How can we make this work on Windows?
    if [[ $PROFILE_LOCATION == system ]]; then
        sudo -n "$@"
    else
        "$@"
    fi
}

profile_cat() {
    profile_sudo tee "$1" >/dev/null
}

ensure_profile_is_deleted() {
    delete_profile
    if profile_exists; then
        fatal "Cannot delete $(profile_location)"
    fi
}

# Only run this once per test file. It cannot be part of setup_file() because
# we want to be able to call fatal() and skip the rest of the tests.
if [[ -z ${BATS_SUITE_TEST_NUMBER:-} ]] && deleting_profiles; then
    foreach_profile ensure_profile_is_deleted
fi
