# Tips for Working with OBS

This document is for those who are getting started with OBS, and for
those who are using it but having a hard time. OBS is not the easiest
system to learn or use, but there are ways of using it that are easier,
and certain pitfalls that are easily avoided if one knows how. This
document contains hard-earned knowledge on how to use it most effectively.

If you have not used OBS before, you should read [Getting Started](#Getting Started)
and [Important Concepts](#Important Concepts) first. Then, come back to
the other sections as you begin to work with the relevant parts of OBS.


## Getting Started

The first thing you need to work with OBS is an installation of
openSUSE Leap. Tumbleweed may work, but given its bleeding-edge
nature, Leap is probably a better bet.

The reason you need an installation of openSUSE is because any
real work you do with OBS should be done using the `osc` command
line tool. There *is* a web interface, but it lacks much of the
functionality that you will need. Use it for checking on the status
of your package, and possibly small changes, but for everything else
use `osc`.


## Important Concepts

In order to use OBS you need to understand certain concepts.
Unfortunately, the way these concepts work and fit together is not
intuitive, nor is the documentation helpful in understanding them.
A brief overview of these concepts, and how they interact, is provided
here.

A **project** is the object in which you do everything in OBS.
Everything falls under projects: repositories, packages, services,
all of these things must belong to a project. You have to be an
OBS admin to create a root-level project, so our project (`Rancher`)
was created as a subproject of the `isv` root project. Projects may
have subprojects, which are themselves full projects. Projects are
referred to as each of their parent projects plus their name, all
separated by colons. So to refer to our project, you use the name
`isv:Rancher`.

A **repository** is configured on a project. The best way to think of
repositories is in the context of package managers: they are a remote
endpoint from which you can download packages. It is possible to configure
several types of repositories, including those that interface with
package managers such as `apt` and `dnf`, and those that simply serve
AppImages. You can configure multiple repositories on each project.
This comes in handy when you want to make builds of multiple package
formats from the same source code.

A **package** is also configured on a project. Conceptually, OBS packages
are different from packages in other contexts. In OBS, a package represents
a set of files that goes into a build, including source files and any package
metadata files (such as rpm .spec files). Also, from the perspective of the
user's package manager, an OBS package represents only one version of the
package. So if you want to provide multiple versions of the package in the
repository, you must have one OBS package for each version.

A **service** is basically a script that runs at certain times, or can be
triggered manually. A common use for services is to get the latest version of code
from version control before building and packaging that code.
For more information on services see below; also, the 
[documentation][service_documentation] for services is somewhat helpful.

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
