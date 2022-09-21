!include "x64.nsh"

!macro customHeader
  ManifestSupportedOS Win10
  # Enable ShowInstDetails to get logs from scripts.
  #ShowInstDetails show
!macroend

!macro customInstall
  Push $R0

  ${If} ${IsWow64}
    ${DisableX64FSRedirection}
  ${EndIf}

  # Add the bin directory to the PATH
  File "/oname=$PLUGINSDIR\add-to-path.ps1" "${BUILD_RESOURCES_DIR}\add-to-path.ps1"
  nsExec::ExecToLog 'powershell.exe \
    -NoProfile -NonInteractive -ExecutionPolicy RemoteSigned \
    -File "$PLUGINSDIR\add-to-path.ps1" "$INSTDIR"'
  Pop $R0

  # Installs everything that requires elevation
  # including WSL and RD Privileged service
  File "/oname=$PLUGINSDIR\elevated-install.ps1" "${BUILD_RESOURCES_DIR}\elevated-install.ps1"
  # Note that the script might restart itself (synchronously) if we need to
  # elevate here.
  nsExec::ExecToLog 'powershell.exe \
    -NoProfile -NonInteractive -ExecutionPolicy RemoteSigned \
    -File "$PLUGINSDIR\elevated-install.ps1" "-InstallDir:$INSTDIR"'
  Pop $R0
  ${If} $R0 == "error"
    Abort "Error occured during elevated install."
  ${ElseIf} $R0 == 0
    # WSL was already installed
  ${ElseIf} $R0 == 101
    # WSL was installed, a reboot is required.
    SetRebootFlag true
  ${ElseIf} $R0 == 102
    Abort "Unexpected error installing Rancher Desktop Privileged Service."
  ${Else}
    # Unexpected exit code
    Abort "Unexpected error installing Windows subsystem for Linux: $R0"
  ${EndIf}

  ${If} ${IsWow64}
    ${EnableX64FSRedirection}
  ${EndIf}

  Pop $R0
!macroend

# Bypass the install mode prompt, always install per-user.
!macro customInstallMode
  StrCpy $isForceCurrentInstall "1"
!macroend

!macro customUnInstall
  # Remove the bin directory from the PATH
  File "/oname=$PLUGINSDIR\remove-from-path.ps1" "${BUILD_RESOURCES_DIR}\remove-from-path.ps1"
  nsExec::ExecToLog 'powershell.exe \
    -NoProfile -NonInteractive -ExecutionPolicy RemoteSigned \
    -File "$PLUGINSDIR\remove-from-path.ps1" "$INSTDIR"'
  Pop $R0

  # Uninstall Priviliged Service
  File "/oname=$PLUGINSDIR\uninstall-privileged-service.ps1" "${BUILD_RESOURCES_DIR}\uninstall-privileged-service.ps1"
  nsExec::ExecToLog 'powershell.exe \
    -NoProfile -NonInteractive -ExecutionPolicy RemoteSigned \
    -File "$PLUGINSDIR\uninstall-privileged-service.ps1" "$INSTDIR"'
  Pop $R0
!macroend
