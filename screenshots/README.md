# screenshots

This is the e2e task that automatically collects screenshots of the UI.


## Overview

It runs as any other `Playwright` e2e test and uses a proper utility for each platform to
collect screenshots of the main sections of the UI. Screenshots are either produced in
light & dark mode.


## Prerequisites

### MacOS

`screencapture` is required. It is part of the OS, so doesn't need to be installed
separately. See https://ss64.com/osx/screencapture.html

`GetWindowID` is also required, and can be installed running `brew install
smokris/getwindowid/getwindowid`.

If you're experiencing any issues like `screencapture: no file specified` or
`could not create image from window` while running the screenshots script, it's most
likely related to your privacy settings. Try to enable the 'Terminal' option at:
System Preferences -> Security & Privacy -> Privacy -> Screen Recording.

### Windows

`ShareX` is required. See https://github.com/ShareX/ShareX

Extract the `ShareX-15.0.0-portable.zip` into the resources directory, so that the
`ShareX.exe` is located under `{path-to-rancher-desktop}\resources\ShareX\ShareX.exe`.

### Linux

`gnome-screenshot` is required. See https://github.com/GNOME/gnome-screenshot


## Running

First, install dependencies with:

```
npm install
```

Make sure you have run a "Factory Reset" before capturing screenshots, so they show the
default settings and not your current configuration.

On macOS and Linux, after the "Factory Reset" run the app once manually (`yarn dev`)
to disable admin access. Otherwise the `screenshots` script will hang when the password
prompt comes up.

Then, capture screenshots in both dark & light mode:

```
yarn screenshots
```

Light mode only:

```
yarn screenshots:light
```

Dark mode only:

```
yarn screenshots:dark
```


## Environment Variables

- RD_ENV_SCREENSHOT_SLEEP

  To use in `Windows`, allow the script enough time to write and copy each screenshot
  before moving to the next:
  ```
  $Env:RD_ENV_SCREENSHOT_SLEEP = 5000; yarn screenshots
  ```

- RD_MOCK_VERSION

  Customize the app version, this is useful for populating documentation before release
  activities are finalized.
  ```
  export RD_MOCK_VERSION=1.0.0; yarn screenshots
  ```

## Output

The directory where the screenshots are saved:

  ```
  screenshots/output
  ```
