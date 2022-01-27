# Tips for Working with OBS

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


## Object Definitions

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
