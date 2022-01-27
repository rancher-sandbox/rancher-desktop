# Tips for Working with OBS

This document is intended for those who are getting started
with OBS, and those who may not be familiar with how to best
use it and what some pitfalls to avoid are when using it.

## Getting Started

While OBS has a web interface that appears, at first blush,
to be fairly good, it is missing a bunch of functionality.
At best, it is good for quickly checking the state of your
packages and your builds.

To actually do anything with OBS, you should use the `osc`
command line tool. This is how you exploit the full functionality
of OBS. And to use `osc`, you need to be on some kind of
openSUSE distribution of Linux.

To summarize:
- learn and use `osc` rather than the web interface
- you need to be on openSUSE of some kind


## Important Concepts

In order to use OBS you will need to understand some of the
concepts it deals with. However, this is not the easiest, since
the documentation does not give any high-level overview, and
the way the concepts interact is not intuitive. A brief overview
of these concepts, and how they interact, is provided here.

A **project** is the object in which you do everything in OBS.
You have to be an OBS admin to create a root-level project,
so our top-level project (`Rancher`) was created as a subproject
of the `isv` root project. When referring to projects, you
refer to them as their name plus all parent projects, with each
project/subproject separated by a colon. So to refer to our
top-level project, you use the name `isv:Rancher`.

A **repository** is something that is configured on a project.
The best way to describe repositories is as we think of them
in the context of package managers: they are a remote endpoint
from which you can download packages. It is possible to configure
many different types of repositories, from those that interface with
package managers such as `apt` and `dnf`, to those that simply
are a place to download an AppImage from. You can configure multiple
repositories on each project. This comes in handy when you want
to make builds of multiple package formats from the same source code.

A **package** is something that works a little different in OBS
from how you might be used to it in other contexts. In OBS,
a package represents a single version of whatever application
or library you are assigning to it. A package is built multiple
times, probably into different formats, for each repository that
is configured on the project to which the package belongs. Note
that because a package represents only one version of the code
you are using OBS to package, if you want to make multiple versions
of that application available in OBS, you need to have multiple
packages to provide those versions.

A **service** is basically a script that runs at certain times, 
or can be triggered manually.
A common use for services is to get the latest version of code
from version control before building and packaging that code.
For more information on services see below; also, the 
[documentation](service_documentation) for services is somewhat helpful.

[service_documentation]: https://openbuildservice.org/help/manuals/obs-user-guide/cha.obs.source_service.html#sec.obs.sserv.about


## Service Tips

Before doing anything with services, you should ensure that you have
the most recent versions of any services available in the repositories
that are installed on your installation of openSUSE. You should also
ensure that any services you have are updated to the latest version.
They do not always (ever?) use semantic versioning despite having versions
of the form `X.Y.Z`. In order to get the latest versions of services,
you need to configure some new repositories:

```
zypper addrepo https://download.opensuse.org/repositories/openSUSE:/Tools/openSUSE_15.3/openSUSE:Tools.repo
zypper refresh
```

If you aren't on Leap 15.3, you may have to find a different version of
this repo, but this is what works at the time of writing.

### How to find out what services are available

Services come in the form of rpm packages that can be installed via `zypper`.
In order to search your installed repos for services, simply run:

```
zypper search obs-service
```

### How to find out what configuration each service takes

Once services are installed you can look at their interface schema in order
to understand how to use them. The interface schema (as well as the source code)
are stored in the directory `/usr/lib/obs/`.


## Local Build Tips

`osc` allows you to do local builds, which can come in very handy when you
are trying to get a new package to build, or debugging an existing package build.
However, there are some non-obvious things here.

One pitfall is that some mirrors are very slow. In order to get around this,
you can just download dependencies from the OBS API. **here is the option to do this**

Another thing to know is how to trigger the `obs build` command. You need to
provide **these arguments**.

The other thing to know is that the output of the build will go to a very strange,
obscure directory. To know the location of your build output, simply look at
the text that the build has printed at the screen. There should be a path
at the end of it, which is where you can find your built package.


## Additional Resources

- The `help-obs` and `discuss-zypp` channels are always friendly and helpful.
- The [OBS documentation] is not the greatest, but might resolve your problems.
- The output of `osc --help` is moderately helpful.
