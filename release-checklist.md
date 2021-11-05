## Release Checklist

- [] Update version number in package.json if not done after last release.
- [] Tag release branch.
- [] Trigger build on tagged branch (usually main, unless it's a patch release. This step is triggered automatically once the tagged branch is pushed).
- [] Update the release version for upgrader.
- [] Sign windows installer and upload to Github Release.
  Sign mac installer (As there's a issue with the zip produced by the build script, we need to manually build and zip, rename the file to replace space with dot etc )
- [] Make sure the required env variables are set for the notorize, signing process.
- [] git clean, reset to make sure a clean (CI equivalent) build.
- [] Manually zip the installer.
- [] Rename installer filename to replace space with dot.

- [] Perform smoke test on release artifacts
- [] Update Github releases page
  Release Documentation
- [] Release notes
- [] docs update (Help, Readme..)
- [] Slack Announcements
- [] Newsletter summary
- [] Update metrics, roadmap on Confluence page
  Marketing
- [] Blog post
- [] New Features walkthrough, Demo for Youtube channel etc.