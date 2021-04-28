!macro customInstall
  # Add the bin directory to the PATH
  File "/oname=$PLUGINSDIR\add-to-path.ps1" "${BUILD_RESOURCES_DIR}\add-to-path.ps1"
  ExecShellWait '' 'powershell.exe' \
    '-NoProfile -NonInteractive -ExecutionPolicy RemoteSigned "$PLUGINSDIR\add-to-path.ps1" "$INSTDIR"' \
    SW_HIDE
!macroend

!macro customUnInstall
  # Remove the bin directory from the PATH
  File "/oname=$PLUGINSDIR\remove-from-path.ps1" "${BUILD_RESOURCES_DIR}\remove-from-path.ps1"
  ExecShellWait '' 'powershell.exe' \
    '-NoProfile -NonInteractive -ExecutionPolicy RemoteSigned "$PLUGINSDIR\remove-from-path.ps1" "$INSTDIR"' \
    SW_HIDE
!macroend
