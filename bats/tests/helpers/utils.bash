to_lower() {
    echo "$@" | tr '[:upper:]' '[:lower:]'
}

to_upper() {
    echo "$@" | tr '[:lower:]' '[:upper:]'
}

is_true() {
    # case-insensitive check; false values: '', '0', 'no', and 'false'
    local value
    value=$(to_lower "$1")
    if [[ $value =~ ^(0|no|false)?$ ]]; then
        false
    else
        true
    fi
}

is_false() {
    ! is_true "$1"
}

bool() {
    if eval "$1"; then
        echo "true"
    else
        echo "false"
    fi
}

# Ensure that the variable contains a valid value, e.g.
# `validate_enum VAR value1 value2`
validate_enum() {
    local var=$1
    shift
    for value in "$@"; do
        if [ "${!var}" = "$value" ]; then
            return
        fi
    done
    fatal "$var=${!var} is not a valid setting; select from [$*]"
}

assert_nothing() {
    # This is a no-op, used to show that run() has been used to continue the
    # test even when the command failed, but the failure itself is ignored.
    true
}

########################################################################

assert=assert
refute=refute

before() {
    local assert=refute
    local refute=assert
    "$@"
}

refute_success() {
    assert_failure
}

refute_failure() {
    assert_success
}

refute_not_exists() {
    assert_exists "$@"
}

########################################################################

# Convert raw string into properly quoted JSON string
json_string() {
    echo -n "$1" | jq -Rr @json
}

# Join list elements by separator after converting them via the mapping function
# Examples:
#   join_map "/" echo usr local bin            =>   usr/local/bin
#   join_map ", " json_string a b\ c\"d\\e f   =>   "a", "b c\"d\\e", "f"
join_map() {
    local sep=$1
    local map=$2
    shift 2

    local elem
    local result=""
    for elem in "$@"; do
        elem=$(eval "$map" '"$elem"')
        if [[ -z $result ]]; then
            result=$elem
        else
            result="${result}${sep}${elem}"
        fi
    done
    echo "$result"
}

jq_output() {
    jq -r "$@" <<<"${output}"
}

get_setting() {
    run rdctl api /settings
    assert_success || return
    jq_output "$@"
}

this_function() {
    echo "${FUNCNAME[1]}"
}

calling_function() {
    echo "${FUNCNAME[2]}"
}

# Write a comment to the TAP stream
# Set CALLER to print a calling function higher up in the call stack.
trace() {
    if is_true "$RD_TRACE"; then
        echo "# (${CALLER:-$(calling_function)}): $*" >&3
    fi
}

try() {
    local max=24
    local delay=5
    while [[ $# -gt 0 ]] && [[ $1 == -* ]]; do
        case "$1" in
        --max)
            max=$2
            shift
            ;;
        --delay)
            delay=$2
            shift
            ;;
        --)
            shift
            break
            ;;
        *)
            printf "Usage error: unknown flag '%s'" "$1" >&2
            return 1
            ;;
        esac
        shift
    done

    local count
    for ((count = 0; count < max; ++count)); do
        run "$@"
        if ((status == 0)); then
            break
        fi
        sleep "$delay"
    done
    echo "$output"
    return "$status"
}

image_without_tag_as_json_string() {
    local image=$1
    # If the tag looks like a port number and follows something that looks
    # like a domain name, then don't strip the tag (e.g. foo.io:5000).
    if [[ ${image##*:} =~ ^[0-9]+$ && ${image%:*} =~ \.[a-z]+$ ]]; then
        json_string "$image"
    else
        json_string "${image%:*}"
    fi
}

update_allowed_patterns() {
    local enabled=$1
    shift

    local patterns
    patterns=$(join_map ", " image_without_tag_as_json_string "$@")

    # TODO TODO TODO
    # Once https://github.com/rancher-sandbox/rancher-desktop/issues/4939 has been
    # implemented, the `version` field  should be made a constant. Putting in the
    # current version here doesn't guarantee that the structure conforms to the latest
    # schema; we should rely on migrations instead.
    # TODO TODO TODO
    rdctl api settings -X PUT --input - <<EOF
{
  "version": $(get_setting .version),
  "containerEngine": {
    "allowedImages": {
      "enabled": $enabled,
      "patterns": [$patterns]
    }
  }
}
EOF
}

# unique_filename /tmp/image .png
# will return /tmp/image.png, or /tmp/image_2.png, etc.
unique_filename() {
    local basename=$1
    local extension=${2:-}
    local index=1
    local suffix=""

    while true; do
        local filename="$basename$suffix$extension"
        if [ ! -e "$filename" ]; then
            echo "$filename"
            return
        fi
        index=$((index + 1))
        suffix="_$index"
    done
}

capture_logs() {
    if capturing_logs && [ -d "$PATH_LOGS" ]; then
        local logdir
        logdir=$(unique_filename "${PATH_BATS_LOGS}/${RD_TEST_FILENAME}")
        mkdir -p "$logdir"
        cp -LR "$PATH_LOGS/" "$logdir"
        echo "${BATS_TEST_DESCRIPTION:-teardown}" >"$logdir/test_description"
        # Capture settings.json
        cp "$PATH_CONFIG_FILE" "$logdir"
        foreach_profile export_profile "$logdir"
    fi
}

take_screenshot() {
    if taking_screenshots; then
        if is_macos; then
            local file
            file=$(unique_filename "${PATH_BATS_LOGS}/${BATS_SUITE_TEST_NUMBER}-${BATS_TEST_DESCRIPTION}" .png)
            mkdir -p "$PATH_BATS_LOGS"
            # The terminal app must have "Screen Recording" permission;
            # otherwise only the desktop background is captured.
            # -x option means "do not play sound"
            screencapture -x "$file"
        fi
    fi
}
