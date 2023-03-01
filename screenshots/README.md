# screenshots

This is the e2e task that automatically collects screenshots of the UI.


## Overview

It runs as any other `Playwright` e2e test and uses a proper utility for each platform to collect screenshots of the main sections of the UI.
Screenshots are either produced in light & dark mode.


## Prerequisites

### MacOS

`screencapture` is required. See https://ss64.com/osx/screencapture.html

### Windows

`ShareX` is required. See https://github.com/ShareX/ShareX

Extract the `ShareX-15.0.0-portable.zip` into the resources directory, so that the `ShareX.exe` is located under `{path-to-rancher-desktop}\resources\ShareX\ShareX.exe`. 

### Linux

`gnome-screenshot` is required. See https://github.com/GNOME/gnome-screenshot


## Running

> ℹ️ SETTING THE VERSION NUMBER
>
> Customize the version displayed by updating the version in `package.json` before running screenshots. This is useful for populating documentation before release activities are finalized.

First, install dependencies with:

```
npm install
```

Then, capture screenshots in both dark & light mode:

```
npm run screenshots
```

Light mode only:

```
npm run screenshots:light
```

Dark mode only:

```
npm run screenshots:dark
```

### Windows

Use the `RD_ENV_SCREENSHOT_SLEEP` environment variable to allow the script enough time to write and copy each screenshot before moving to the next:

```
$Env:RD_ENV_SCREENSHOT_SLEEP = 5000; npm run screenshots
```

## Output

The directory where the screenshots are saved:

  ```
  screenshots/output
  ```
