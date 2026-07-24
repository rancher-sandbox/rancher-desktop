load '../helpers/load'

# Drive the updater through a whole upgrade against a local stand-in for the
# Upgrade Responder and the GitHub releases API.
#
# The main process bundles its own copy of electron-updater, so a packaging
# mistake can leave the updater unable to fetch anything at all while every
# other test still passes. Nothing here installs the update; the test follows
# the updater as far as it gets on its own, which is a verified download.

local_setup_file() {
    # Assign before skipping: teardown still runs for a skipped file, and would
    # trip over the unset variables under `set -o nounset`.
    export UPDATE_SERVER_SCRIPT="$BATS_TEST_DIRNAME/update-server.mjs"
    export UPDATE_SERVER_URL_FILE="$BATS_FILE_TMPDIR/update-server-url"
    export UPDATE_SERVER_PID_FILE="$BATS_FILE_TMPDIR/update-server-pid"
    export UPDATE_LOG="$PATH_LOGS/update.log"
    # Beside the updater's own log, so log capture collects the request trace.
    # Not a `.log`: the application deletes every log file it does not own.
    export UPDATE_SERVER_LOG="$PATH_LOGS/update-server.txt"

    if is_linux; then
        skip 'the updater only downloads on Linux when the app runs from an AppImage'
    fi
    # bats runs inside WSL, where the server would offer the app a Linux asset,
    # and exported variables never reach a Win32 process.
    skip_on_windows 'the update server cannot serve the Win32 app from inside WSL'
}

# The next test file would factory reset anyway, but only this one downloads a
# release that must never be installed, so it takes the update back out here too.
local_teardown_file() {
    if [ -s "$UPDATE_SERVER_PID_FILE" ]; then
        kill "$(cat "$UPDATE_SERVER_PID_FILE")" || true
    fi
    delete_pending_update
}

assert_update_server_ready() {
    run -0 cat "$UPDATE_SERVER_URL_FILE"
    assert_output --partial 'http://127.0.0.1:'
}

# The updater logs every step it takes, so the log is the record of what it did.
assert_update_log_contains() { # <pattern>
    run -0 cat "$UPDATE_LOG"
    assert_output --partial "$1"
}

@test 'factory reset' {
    factory_reset
    rm -f "$UPDATE_SERVER_URL_FILE" "$UPDATE_LOG" "$UPDATE_SERVER_LOG"
}

@test 'start the update server' {
    node "$UPDATE_SERVER_SCRIPT" "$UPDATE_SERVER_URL_FILE" "$UPDATE_SERVER_LOG" &
    echo "$!" >"$UPDATE_SERVER_PID_FILE"
    try assert_update_server_ready
}

@test 'launch the application with updates enabled' {
    run -0 cat "$UPDATE_SERVER_URL_FILE"
    url=${output}

    # The update config that ships with the application names the owner and repo;
    # the update server answers for whichever ones it names.
    export RD_FORCE_UPDATES_ENABLED=1
    export RD_UPGRADE_RESPONDER_URL="${url}/v1/checkupgrade"
    export RD_GITHUB_API_URL="${url}"

    # The updater runs before the backend starts, so this never needs Kubernetes.
    launch_the_application --application.debug --kubernetes.enabled=false
}

@test 'the updater offers the simulated release' {
    # Confirm the updater ran at all before asserting what it found, so a failed
    # launch reports as one instead of as a missing version.
    try --max 36 --delay 5 assert_update_log_contains 'Checking for update'
    try assert_update_log_contains 'Found version v9.9.9'
}

@test 'the updater downloads the release' {
    # A bundling mistake breaks exactly here: the download throws before it
    # transfers a byte, so the update is never offered for install.
    try assert_update_log_contains 'New version v9.9.9 has been downloaded'
    # macOS then hands the stub to Squirrel, which rejects it. That error in
    # update.log is expected, and installs nothing.
}

@test 'the updater resolved its bundled dependencies' {
    # `(0 , o.readFile) is not a function`: electron-updater got bundled into the
    # main process, and its own imports lost the exports Node cannot see.
    run -0 cat "$UPDATE_LOG"
    # An empty log would refute the substring without the updater having run at
    # all, so make sure it did.
    assert_output --partial 'Checking for update'
    refute_output --partial 'o.readFile) is not a function'
}

@test 'shut down' {
    rdctl shutdown
}
