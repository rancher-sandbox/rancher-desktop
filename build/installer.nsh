!include "x64.nsh"

# ### Variables
# whether we need to install WSL components
Var /GLOBAL isWSLInstallRequired

!macro customHeader
  ManifestSupportedOS Win10
  # Enable ShowInstDetails to get logs from scripts.
  #ShowInstDetails show
!macroend

!macro preInit
  # We need to set this in the uninstaller to mute a warning about the variable
  # never being used
  strCpy $isWSLInstallRequired 0
!macroEnd

!macro customInit
  # Check if we need to install WSL
  DetailPrint "Checking if we need to install WSL..."
  File "/oname=$PLUGINSDIR\install-wsl.ps1" "${BUILD_RESOURCES_DIR}\install-wsl.ps1"
  nsExec::ExecToLog 'powershell.exe \
    -NoProfile -NonInteractive -ExecutionPolicy RemoteSigned \
    -File "$PLUGINSDIR\install-wsl.ps1" "-DryRun"'
  Pop $R0

  ${If} $R0 == 102
    StrCpy $isWSLInstallRequired 1
    DetailPrint "WSL installation is required."
  ${Else}
    DetailPrint "WSL installation is not required."
  ${EndIf}
!macroEnd

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

  # Install WSL, if required
  ${If} $isWSLInstallRequired > 0
    DetailPrint "Installing Windows Subsystem for Linux"
    File "/oname=$PLUGINSDIR\install-wsl.ps1" "${BUILD_RESOURCES_DIR}\install-wsl.ps1"
    # Note that the script might restart itself (synchronously) if we need to
    # elevate here.
    nsExec::ExecToLog 'powershell.exe \
      -NoProfile -NonInteractive -ExecutionPolicy RemoteSigned \
      -File "$PLUGINSDIR\install-wsl.ps1"'
    Pop $R0
    ${If} $R0 == "error"
      Abort "Could not install Windows Subsystem for Linux."
    ${ElseIf} $R0 == 0
      # WSL was already installed
    ${ElseIf} $R0 == 101
      # WSL was installed, a reboot is required.
      SetRebootFlag true
    ${Else}
      # Unexpected exit code
      Abort "Unexpected error installing Windows subsystem for Linux: $R0"
    ${EndIf}
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
!macroend
