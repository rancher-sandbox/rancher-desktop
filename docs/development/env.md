# Internal Rancher Desktop environment variables

These variables are used for build and development purposes; they are not meant to be set by users.

They do not form an API and may be changed or removed at any time without prior notice.

## RD_DEBUG_ENABLED=anything

Forces debug logging to always be enabled. Useful to debug first-run issues when there is no `settings.yaml` yet to set debug mode.

## RD_FORCE_UPDATES_ENABLED=anything

When set, it will force auto-update to be enabled even in `yarn dev` mode. Updates will be checked and downloaded, but **not** installed.

## RD_MOCK_MACOS_VERSION=semver

Used for testing compatibility of the app with the OS version, for upgrade responder tests, and for enabling/disabling certain parts of the preferences (related to VZ emulation mode).

## RD_UPGRADE_RESPONDER_URL=http://localhost:8314/v1/checkupgrade

Set an alternate upgrade responder endpoint for testing.
