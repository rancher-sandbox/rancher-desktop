## Release Checklist

- [ ] Update version number in package.json if not done after last release.
- [ ] Tag release branch. Wait for the CI to build artifacts.
- [ ] Sign windows installer.

### Sign mac installer (As there's an issue with the zip produced by the build script, we need to manually build and zip, rename the file to replace space with dot etc )
- [ ] Make sure the required env variables are set for the notarize, signing process.
- [ ] git clean, reset to make sure a clean (CI equivalent) build.
- [ ] Manually zip the installer.
- [ ] Rename installer filename to replace space with dot.

### Release Documentation
- [ ] Release notes. Update on the GitHub draft Release page.
- [ ] docs update (Help, Readme..)
- [ ] Slack Announcements
- [ ] Newsletter summary
- [ ] Update metrics, roadmap on Confluence page

### Release
- [ ] Perform smoke test on release artifacts.
- [ ] Upload mac, win release artifacts on the GitHub draft Release page.
- [ ] Update the release version for upgrade responder.
- [ ] Move from draft release to Release.
- [ ] Check the auto update functionality.
