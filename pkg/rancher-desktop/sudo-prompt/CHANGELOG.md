# Rancher Desktop related changes

This module has been imported from https://github.com/jorangreef/sudo-prompt/tree/v9.2.1 (commit c3cc31a) and modified for Rancher Desktop:

The `applet.app` used to be included as a base64 encoded ZIP file inside `index.js` and extracted at runtime into a temp directory. The extracted app was renamed to match the `name` and `icns` specified by the caller, and the commands were written into `applet.app/Content/MacOS/sudo-prompt-command`.

The bundled applet did not include support for `aarch64` machines, so needed Rosetta2 installed to run. It was also not signed.

## Changes

The applet source code has been moved to `<repo>/src/sudo-prompt` and is built from source using `osacompile`, so `applet` will be an up-to-date universal binary supporting `x86_64` and `aarch64`.

The applet is placed into `<repo>/resources/darwin/internal/Rancher Desktop.app`. The app name is displayed as part of the dialog: "Rancher Desktop wants to make changes".

The `Contents/Info.plist` file has the `CFBundleName` set to "Rancher Desktop Password Prompt".

A `.icns` format icon has been created (the old `.png` file doesn't seem to work with the new applet) and is stored into `Contents/Resources/applet.icns`.

The `sudo-prompt-script` has been moved from `Contents/MacOS` to `Contents/Resources/Scripts` because it cannot be code-signed.

When the `RD_SUDO_PROMPT_OSASCRIPT` environment variable is set then the `Contents/Resources/Scripts/main.scpt` file (the compiled version of `sudo-prompt.applescript`) is executed via `osascript` instead of the applet. This will show an approval prompt that supports the Apple watch, or a touch id keyboard, but will not use the `Rancher Desktop` name or icon in the dialog.

The `sudo-prompt.applescript` has been modified to locate the `sudo-prompt-script` inside the applet because the working directory will no longer be inside the app.

All this means that the app can now be code-signed and notarized and will not be modified at runtime.

The app is being build by `yarn` during the `postinstall` phase with a custom dependency script.

The `index.js` code to modify the app at runtime has been removed and the logic simplified. `name` and `icns` options are ignored in the macOS `sudo` function.
<hr>

# Original CHANGELOG below

## [9.2.0] 2020-04-29

### Fixed

- Update TypeScript types to accommodate recent changes, see
[#117](https://github.com/jorangreef/sudo-prompt/issues/117).

## [9.1.0] 2019-11-13

### Added

- Add TypeScript types.

## [9.0.0] 2019-06-03

### Changed

- Make cross-platform `stdout`, `stderr` behavior consistent, see
[#89](https://github.com/jorangreef/sudo-prompt/issues/89).

- Preserve current working directory on all platforms.

- Improve kdesudo dialog appearance.

### Added

- Add `options.env` to set environment variables on all platforms, see
[#91](https://github.com/jorangreef/sudo-prompt/issues/91).

### Fixed

- Always return PERMISSION_DENIED as an Error object.

- Support multiple commands separated by semicolons on Linux, see
[#39](https://github.com/jorangreef/sudo-prompt/issues/39).

- Distinguish between elevation errors and command errors on Linux, see
[#88](https://github.com/jorangreef/sudo-prompt/issues/88).

- Fix Windows to return `PERMISSION_DENIED` Error even when Windows' error
messages are internationalized, see
[#96](https://github.com/jorangreef/sudo-prompt/issues/96).

## [8.2.5] 2018-12-12

### Fixed

- Whitelist package.json files.

## [8.2.4] 2018-12-12

### Added

- A CHANGELOG.md file, see
[#78](https://github.com/jorangreef/sudo-prompt/issues/78).

## [8.2.3] 2018-09-11

### Fixed

- README: Link to concurrency discussion.

## [8.2.2] 2018-09-11

### Fixed

- README: Details on concurrency.

## [8.2.1] 2018-09-11

### Fixed

- A rare idempotency edge case where a command might have been run more than
once, given a very specific OS environment setup.

## [8.2.0] 2018-03-22

### Added

- Windows: Fix `cd` when `cwd` is on another drive, see
[#70](https://github.com/jorangreef/sudo-prompt/issues/70).

## [8.1.0] 2018-01-10

### Added

- Linux: Increase `maxBuffer` limit to 128 MiB, see
[#66](https://github.com/jorangreef/sudo-prompt/issues/66).

## [8.0.0] 2018-11-02

### Changed

- Windows: Set code page of command batch script to UTF-8.

## [7.1.1] 2017-07-18

### Fixed

- README: Explicitly mention that no child process is returned.

## [7.0.0] 2017-03-15

### Changed

- Add status code to errors on Windows and macOS.

## [6.2.1] 2016-12-16

### Fixed

- README: Syntax highlighting.

## [6.2.0] 2016-08-17

### Fixed

- README: Rename OS X to macOS.

## [6.1.0] 2016-08-02

### Added

- Yield an error if no polkit authentication agent is found, see
[#29](https://github.com/jorangreef/sudo-prompt/issues/29).

## [6.0.2] 2016-07-21

### Fixed

- README: Update explanation of Linux behavior.

## [6.0.1] 2016-07-15

### Fixed

- Update keywords in package.json.

## [6.0.0] 2016-07-15

### Changed

- Add support for Windows.
