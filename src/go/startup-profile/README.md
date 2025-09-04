# startup-profile

This is a tool to profile Rancher Desktop startup to try to guide optimizing
startup times.  It scrapes various logs to generate data that can be loaded into
Chrome developer tools.

## Usage

1. Start Rancher Desktop using `yarn dev`.
2. Wait until startup is complete; keep it running.
3. Run this tool (via `go run .`) to generate a `.cpuprofile` file.
4. Open Chrome (or other Chromium-derived browser) developer tools, and go to
   the _Performance_ tab.
5. Click on the _Load Profile_ button (looks something like `↥`) and load the
   generated file.
6. Alternatively, load the same file using https://profiler.firefox.com/
