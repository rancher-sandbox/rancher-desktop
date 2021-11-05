## Release Checklist

- [x] Update version number in package.json if not done after last release.
- [x] Tag release branch.
- [x] Trigger build on tagged branch (usually main, unless it's a patch release. This step is triggered automatically once the tagged branch is pushed).
- [x] Update the release version for upgrader.
- [x] Sign windows installer and upload to Github Release.
- [x] Sign Linux installer and upload to Github Release.
### Sign mac installer (As there's a issue with the zip produced by the build script, we need to manually build and zip, rename the file to replace space with dot etc )
- [x] Make sure the required env variables are set for the notorize, signing process.
- [x] git clean, reset to make sure a clean (CI equivalent) build.
- [x] Manually zip the installer.
- [x] Rename installer filename to replace space with dot.
- [x] Upload to release page

### Smoke test on release 
- [x] Perform smoke test on release artifacts

### Release Documentation
- [x] Release notes. Update Github releases page
- [x] docs update (Help, Readme..)
- [x] Slack Announcements
- [x] Newsletter summary
- [x] Update metrics, roadmap on Confluence page

### Marketing
- [x] Blog post
- [x] New Features walkthrough, Demo for Youtube channel etc.
