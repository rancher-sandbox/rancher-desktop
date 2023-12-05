# Linux Release Process

**Note**: please read the [OBS Tips Documentation](obs.md)
before this document. It includes information that is important to be familiar
with when working with OBS.


## When do I need to modify OBS?

OBS is set up so that you only need to act when you are releasing
a new major or minor version of Rancher Desktop. For example, when
we released 1.11.0 we had to make changes. When we released 1.11.1
nothing had to be done other than the usual checks.


## How do I modify OBS when releasing a new major or minor version?

Before you begin, you must have `osc` set up. Once you have that done,
you can create a new package for the new major-minor version. Luckily,
we don't have to create a new package from scratch: we can use the
`osc copypac` command to copy an existing package. This command has
the following signature:
```
osc copypac <source_project> <source_package> <destination_project> <destination_package>
```
For example, if we wanted to copy the `rancher-desktop-release-1.11`
package from the `isv:Rancher:dev` project to
`rancher-desktop-release-1.12`, also in the `isv:Rancher:dev` project,
we would run `osc copypac` as follows:
```
osc copypac isv:Rancher:dev rancher-desktop-release-1.11 isv:Rancher:dev rancher-desktop-release-1.12
```
Once this is done, you must update the `_service` file and the `Meta`
tab in the package to refer to the new major-minor version. The
easiest way to do this is via the OBS web interface, which you will
need to be logged into. Generally speaking, you can simply replace
all instances of `1.11` with `1.12` (assuming we're using the above
example). Of course, it is best to understand what you are changing -
the next section will help you with that. Once you have made these
changes, the services will run and the builds should start and
complete successfully.

Finally, you should check the results. This is important - sometimes
the build process falls over, sometimes VMs aren't available to build
your package, and so on. If you run into issues, they are usually
resolved by triggering a rebuild in the web interface. This can
be done by clicking "Trigger Services" in the left navigation bar.
Alternatively, you can trigger a rebuild for a specific package format
by clicking on that package format (i.e. AppImage) from the main page
of the package and then clicking "Trigger rebuild". You will need to
be logged into the web interface to take these actions.

You should also check that the link used to download the "latest"
AppImage *actually* downloads the latest AppImage - the link is
sometimes not updated, at least, not updated promptly.


## How do Linux releases actually *work*?

### The `dev` Channel

The `dev` channel is intended to be used by developers and perhaps
intrepid users. It corresponds to the
[isv:Rancher:dev OBS project](https://build.opensuse.org/project/show/isv:Rancher:dev).

1. A new commit is pushed to a branch of the form `main` or `release-X.Y`
   (for example `release-1.2` or `release-1.11`), which triggers the
   `package.yml` github actions workflow. It builds Rancher Desktop and
   uploads the resultant .zip file to an S3 bucket under a name of the form
   `rancher-desktop-linux-<branch_name>.zip`.
3. As its last step, the `package.yml` workflow triggers a service run in
   the OBS package that corresponds to the branch that triggered the workflow
   run.it. This causes OBS to download and unpack the .zip file that was uploaded
   to S3 in step 2. It also causes OBS to pull some files related to the
   package formats will build from the rancher-desktop repository.
4. The new files trigger a build in OBS.
5. Once the build is complete in OBS, the new versions of the packages are
   available to users to download via `zypper install`, `apt install`, etc.


### The `stable` Channel

The `stable` channel is where actual releases are hosted. It is
intended for use by actual users. The `stable` channel corresponds
to the
[isv:Rancher:stable OBS project](https://build.opensuse.org/project/show/isv:Rancher:stable).
The `stable` build process is similar to the `dev` channel, but works
slightly differently: OBS builds are triggered by published github
releases rather than new commits on branches of a particular format.

1. A new release is published, causing the `linux-release.yml` github
   actions workflow to run. This workflow fetches the linux .zip file
   from the release, and uploads it to AWS S3 with a name in the format
   `rancher-desktop-linux-X.Y.zip` (for example, `rancher-desktop-linux-1.12.zip`).
2. The `linux-release.yml` workflow triggers a service run in the OBS
   package that corresponds to the major and minor version of the tag
   of the published release. This causes OBS to download and unpack the
   .zip file uploaded to S3 in step 1. It also causes OBS to pull some files
   related to the package formats will build from the rancher-desktop
   repository.
4. The new files trigger a build in OBS.
5. Once the build is complete in OBS, the new versions of the packages are
   available to users to download via `zypper install`, `apt install`, etc.
