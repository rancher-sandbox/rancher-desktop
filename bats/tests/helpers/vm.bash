wait_for_shell() {
    try --max 24 --delay 5 $RDCTL shell test -f /var/run/lima-boot-done
    # wait until sshfs mounts are done
    try --max 12 --delay 5 $RDCTL shell test -d $HOME/.rd
    $RDCTL shell sync
}

assert_rd_is_stopped() {
    # run ps -ef
    # local $rancherdesktop="/Applications/Rancher Desktop.app/"
    # ! [[ $output =~ $rancherdesktop ]]
    if is_macos; then
        osascript -e 'if application "Rancher Desktop" is running then error 1' 2>/dev/null
    elif is_linux; then
        ! pgrep rancher-desktop &>/dev/null
    fi
}

wait_for_shutdown() {
    try --max 18 --delay 5 assert_rd_is_stopped
}

factory_reset() {
    run $RDCTL shutdown
    wait_for_shutdown
    limactl delete -f 0
    if is_linux; then
        RD_CONFIG_FILE=$HOME/.config/rancher-desktop/settings.json
    elif is_macos; then
        RD_CONFIG_FILE=$HOME/Library/Preferences/rancher-desktop/settings.json
    fi
    # Make sure supressSudo is true
    cat <<EOF > $RD_CONFIG_FILE
{
  "version": 4,
  "kubernetes": {
    "suppressSudo": true
  },
  "updater": false,
  "pathManagementStrategy": "rcfiles"
}
EOF
}

start_container_runtime() {
    local container_runtime="${1:-$RD_CONTAINER_RUNTIME}"
    if is_macos; then
        open -a "Rancher Desktop" --args \
             --kubernetes-containerEngine "$container_runtime" \
             --kubernetes-enabled=false
    elif is_linux; then
        $RDCTL start \
               --container-engine="$container_runtime" \
               --kubernetes-enabled=false 3>&-
    fi
}
