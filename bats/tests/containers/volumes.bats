load '../helpers/load'

get_tempdir() {
    if ! is_windows || ! using_windows_exe; then
        echo "$BATS_TEST_TMPDIR"
        return
    fi
    # On Windows, create a temporary directory that is in the Windows temporary
    # directory so that it mounts correctly.  Note that in CI we end up running
    # with PSModulePath set to pwsh (7.x) paths, and that breaks the code for
    # PowerShell 5.1.  So we need to have alternative code in that case.
    # See also https://github.com/PowerShell/PowerShell/issues/14100
    if command -v pwsh.exe &>/dev/null; then
        # shellcheck disable=SC2016 # Don't expand PowerShell expansion
        local command='
            $([System.IO.Directory]::CreateTempSubdirectory()).FullName
        '
        run pwsh.exe -Command "$command"
        assert_success
    else
        # PowerShell 5.1 is built against .net Framework 4.x and doesn't have
        # [System.IO.Directory]::CreateTempSubdirectory(); create a temporary
        # file and use its name instead.
        # shellcheck disable=SC2016 # Don't expand PowerShell expansion
        local command='
            $name = New-TemporaryFile
            Remove-Item -Path $name
            # In case anti-virus etc. holds files open, wait for a second to let
            # things settle before we create a new directory with the same name.
            Start-Sleep -Seconds 1
            New-Item -Type Directory -Path $name | Out-Null
            $name.FullName
        '
        run powershell.exe -Command "$command"
        assert_success
    fi
    run wslpath -u "$output"
    assert_success
    echo "$output" | tr -d "\r"
}

local_setup() {
    run get_tempdir
    assert_success
    export WORK_PATH=$output
    run host_path "$WORK_PATH"
    assert_success
    export HOST_WORK_PATH=$output
    export EXPECT_FAILURE=false
}

local_teardown() {
    # Only do manual deletion on Windows; elsewhere we use BATS_TEST_TMPDIR so
    # BATS is expected to do the cleanup.
    if is_windows && [[ -n $HOST_WORK_PATH ]]; then
        powershell.exe -Command "Remove-Item -Recurse -LiteralPath '$HOST_WORK_PATH'"
    fi
}

known_failure_on_mount_type() {
    local mount_type=$1
    local actual_type=$RD_MOUNT_TYPE

    if is_windows; then
        if using_windows_exe; then
            actual_type=win32
        else
            actual_type=wsl
        fi
    fi
    if [ "$actual_type" = "$mount_type" ]; then
        comment "Test is known to fail on $RD_MOUNT_TYPE mounts"
        assert=refute
        refute=assert
        EXPECT_FAILURE=true
    fi
}

@test 'factory reset' {
    factory_reset
}

@test 'start container engine' {
    if is_linux; then
        # On linux, mount BATS_RUN_TMPDIR into the VM so that we can use
        # BATS_TEST_TMPDIR as a volume.
        local override_dir="${HOME}/.local/share/rancher-desktop/lima/_config"
        mkdir -p "$override_dir"
        {
            echo "mounts:"
            echo "- location: ${BATS_RUN_TMPDIR}"
            echo "  writable: true"
        } >"$override_dir/override.yaml"
    fi
    start_container_engine
    wait_for_container_engine
}

@test 'read-only volume mount' {
    # Read a file that was created outside the container.
    file_name=foo
    file_path=$WORK_PATH/$file_name
    file_content=hello

    assert_not_exists "$file_path"
    create_file "$file_path" <<<$file_content

    # Use `--separate-stderr` to avoid image pull messages.
    run --separate-stderr \
        ctrctl run --volume "$HOST_WORK_PATH:/mount:ro" \
        "$IMAGE_BUSYBOX" cat /mount/$file_name
    assert_success
    assert_output $file_content
}

@test 'read-write volume mount' {
    file_name=foo
    file_path=$WORK_PATH/$file_name
    file_content=hello

    # Create a file from the container.
    assert_not_exists "$file_path"
    ctrctl run --volume "$HOST_WORK_PATH:/mount:rw" \
        "$IMAGE_BUSYBOX" sh -c "echo $file_content > /mount/$file_name"

    # Check that the file was written to.
    assert_file_contains "$file_path" $file_content
}

@test 'read-write single file using --mount' {
    file_name=foo
    file_content=hello

    create_file "$WORK_PATH/$file_name" <<<$file_content
    run --separate-stderr \
        ctrctl run --mount "source=$HOST_WORK_PATH/$file_name,target=/mount,type=bind" \
        "$IMAGE_BUSYBOX" cat /mount
    assert_success
    assert_output $file_content
}

@test 'read-write volume mount as user' {
    known_failure_on_mount_type 9p

    file_name=foo
    file_contents=hello
    host_file_path=$HOST_WORK_PATH/$file_name

    # Create a file from within the container.
    run ctrctl run --volume "$HOST_WORK_PATH:/mount:rw" \
        --user 1000:1000 "$IMAGE_BUSYBOX" sh -c "echo $file_contents > /mount/$file_name"
    "${assert}_success"
    run cat "$WORK_PATH/$file_name"
    "${assert}_success"
    if is_true "$EXPECT_FAILURE"; then
        skip "Test expected to fail"
    fi
    assert_output $file_contents

    # Try to append to the file.
    ctrctl run --volume "$HOST_WORK_PATH:/mount:rw" \
        --user 1000:1000 "$IMAGE_BUSYBOX" sh -c "echo $file_contents | tee -a /mount/$file_name"
    # Check that the file was modified.
    run cat "$WORK_PATH/$file_name"
    assert_success
    assert_output $file_contents$'\n'$file_contents
    if is_windows && using_windows_exe; then
        # On Windows, the directory may be owned by a group that the user is in;
        # additionally, there isn't an easy API to get effective access (!?).
        if command -v pwsh.exe &>/dev/null; then
            # shellcheck disable=SC2016 # Don't expand PowerShell expansion
            local command='
                $typeName = "System.Security.Principal.SecurityIdentifier, System.Security.Principal.Windows"
                $type = [System.Type]::GetType($typeName)
                $owner = $(Get-Acl '"'$host_file_path'"').GetOwner($type)
                $owner.Value
            '
            run pwsh.exe -Command "$command"
            assert_success
        else
            # shellcheck disable=SC2016 # Don't expand PowerShell expansion
            local command='
                $type = [System.Type]::GetType("System.Security.Principal.SecurityIdentifier")
                $owner = $(Get-Acl '"'$host_file_path'"').GetOwner($type)
                $owner.Value
            '
            run powershell.exe -Command "$command"
            assert_success
        fi
        local undo
        undo=$(shopt -p extglob || true)
        shopt -s extglob
        local owner=${output%%*([[:space:]])}
        eval "$undo"
        # shellcheck disable=SC2016 # Don't expand PowerShell expansion
        command='
            $identity = [System.Security.Principal.WindowsIdentity]::GetCurrent()
            $groups = $identity.Groups
            $groups.Add($identity.User)
            $groups | ForEach-Object { $_.Value }
        '
        run powershell.exe -Command "$command"
        assert_success
        run cat <<<"${output//$'\r'/}" # Remove carriage returns
        assert_success
        assert_line "$owner"
    else
        # Check that the file is owned by the current user.
        stat_arg=-f # Assume BSD stat
        if { stat --version || true; } | grep 'GNU coreutils'; then
            stat_arg=-c
        fi
        run stat "$stat_arg" '%u:%g' "$WORK_PATH/foo"
        assert_success
        assert_output "$(id -u):$(id -g)"
    fi
}

@test 'host directory does not exist' {
    if using_docker; then
        known_failure_on_mount_type reverse-sshfs
        known_failure_on_mount_type 9p
    fi

    file_name=foo
    dir_name=baz
    file_contents=hello

    # Create a file from the container.
    assert_not_exists "$WORK_PATH/$dir_name"
    run ctrctl run --volume "$HOST_WORK_PATH/$dir_name:/mount:rw" \
        "$IMAGE_BUSYBOX" sh -c "echo $file_contents > /mount/$file_name"
    "${assert}_success"
    # Check that the file was written to.
    if is_true "$EXPECT_FAILURE"; then
        assert_file_not_exists "$WORK_PATH/$dir_name"
    else
        assert_file_exists "$WORK_PATH/$dir_name/$file_name"
        assert_file_contains "$WORK_PATH/$dir_name/$file_name" $file_contents
    fi
}

@test 'directory contains space' {
    dir_name="hello world"
    file_name=foo
    file_contents=hello

    assert_not_exists "$WORK_PATH/$dir_name"
    mkdir "$WORK_PATH/$dir_name"
    ctrctl run --volume "$HOST_WORK_PATH/$dir_name:/mount:rw" \
        "$IMAGE_BUSYBOX" sh -c "echo $file_contents > /mount/$file_name"
    assert_file_exists "$WORK_PATH/$dir_name/$file_name"
    assert_file_contains "$WORK_PATH/$dir_name/$file_name" $file_contents
}

@test 'directory contains non-ascii' {
    dir_name=snow☃︎man
    file_name=foo
    file_contents=hello

    assert_not_exists "$WORK_PATH/$dir_name"
    mkdir "$WORK_PATH/$dir_name"
    ctrctl run --volume "$HOST_WORK_PATH/$dir_name:/mount:rw" \
        "$IMAGE_BUSYBOX" sh -c "echo $file_contents > /mount/$file_name"
    assert_file_exists "$WORK_PATH/$dir_name/$file_name"
    assert_file_contains "$WORK_PATH/$dir_name/$file_name" "$file_contents"
}

@test 'directory should be owned by current user' {
    known_failure_on_mount_type virtiofs
    known_failure_on_mount_type 9p
    known_failure_on_mount_type reverse-sshfs
    known_failure_on_mount_type win32

    user_id=3678:2974

    run --separate-stderr \
        ctrctl run --volume "$HOST_WORK_PATH:/mount:ro" \
        --user $user_id "$IMAGE_BUSYBOX" stat -c '%u:%g' /mount
    assert_success
    "${assert}_output" $user_id
}

@test 'change ownership of mounted file' {
    known_failure_on_mount_type reverse-sshfs
    known_failure_on_mount_type 9p

    file_name=foo
    file_contents=hello

    run ctrctl run --volume "$HOST_WORK_PATH:/mount:rw" \
        --user 0 "$IMAGE_BUSYBOX" \
        sh -c "echo $file_contents > /mount/$file_name; chown 1234:5678 /mount/$file_name"
    "${assert}_success"
    assert_file_exists "$WORK_PATH/$file_name"
    assert_file_contains "$WORK_PATH/$file_name" "$file_contents"
}

@test 'change file permissions' {
    file_name=foo

    assert_not_exists "$WORK_PATH/$file_name"
    local command="
        touch /mount/$file_name
        chmod 0755 /mount/$file_name
        stat -c %A /mount/$file_name
    "
    run --separate-stderr \
        ctrctl run --volume "$HOST_WORK_PATH:/mount:rw" \
        "$IMAGE_BUSYBOX" sh -c "$command"
    assert_success
    "${assert}_output" -rwxr-xr-x # spellcheck-ignore-line
}

@test 'filesystem monitoring' {
    skip_on_windows
    # wait for API
    RD_TIMEOUT=10s try --max 30 --delay 5 rdctl api /settings
    rdctl set --experimental.virtual-machine.mount.inotify
    wait_for_container_engine
    # Build an image that will monitor for changes.
    ctrctl build --file - --tag rd_bats_volume_inotify "$HOST_WORK_PATH" <<<"
        FROM $IMAGE_REGISTRY_2_8_1
        RUN apk add --update-cache --no-interactive inotify-tools
        ENTRYPOINT /usr/bin/inotifywait --recursive --quiet --timeout 30 /mount
    "
    # Schedule a change to be triggered.
    {
        sleep 10
        date >"$HOST_WORK_PATH/foo"
    } &
    # Run the container, which should pick up the change and report it.
    run ctrctl run \
        --volume "$HOST_WORK_PATH:/mount:rw" --pull never \
        rd_bats_volume_inotify
    assert_output --regexp "/mount.*foo"
    assert_success
}
