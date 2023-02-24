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

### Linux

`gnome-screenshot` is required. See https://github.com/GNOME/gnome-screenshot


## Running

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

## Output

The directory where the screenshots are saved:

  ```
  screenshots/output
  ```
