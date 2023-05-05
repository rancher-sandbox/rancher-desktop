is_true() {
    # case-insensitive check; false values: '', '0', 'no', and 'false'
    local value="$(echo "$1" | tr '[:upper:]' '[:lower:]')"
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
    if is_true "$1"; then
        echo "true"
    else
        echo "false"
    fi
}

assert_nothing() {
    # This is a no-op, used to show that run() has been used to continue the
    # test even when the command failed, but the failure itself is ignored.
    true
}

jq_output() {
    jq -r "$@" <<<"${output}"
}

get_setting() {
    local json_key=$1
    run rdctl api /settings
    assert_success
    jq_output "${json_key}"
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
    local count=0
    while [ "$count" -lt "$max" ]; do
        run "$@"
        [ "$status" -eq 0 ] && return
        sleep "$delay"
        count=$((count + 1))
    done
}

update_allowed_patterns() {
    local enabled=$1
    local patterns=$2
    rdctl api settings -X PUT --input - <<EOF
{
  "version": 7,
  "containerEngine": {
    "allowedImages": {
      "enabled": $enabled,
      "patterns": [$patterns]
    }
  }
}
EOF
}
