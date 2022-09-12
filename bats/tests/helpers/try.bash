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
    while [ $count -lt $max ]; do
        run "$@"
        [ $status -eq 0 ] && return
        sleep $delay
        count=$(( count + 1 ))
    done
}
