# Tips for Working with OBS

This document contains information on how to use OBS effectively.
If you have not used OBS before, you should read
[Getting Started](#getting-started) and
[Important Concepts](#important-concepts) first. Then, come back to
the other sections as you begin to work with the relevant parts of OBS.


## Getting Started

The first thing you need to work with OBS is an installation of
openSUSE Leap. Tumbleweed may work, but given its bleeding-edge
nature, Leap is probably a better bet.

The reason you need an installation of openSUSE is because any
real work you do with OBS should be done using the `osc` command
line tool, which is only available on openSUSE. There *is* a web
interface, but it lacks much of the functionality that you will need.
Use it for checking on the status of your package, and possibly small
changes, but for everything else use `osc`.


## Important Concepts

There are a few concepts that one should understand in order to use OBS.
The way they work and interact can be unintuitive at first, so a brief
overview is provided here.

A **project** is the object in which you do everything in OBS.
Everything falls under projects: repositories, packages, services;
all of these things must belong to a project. Projects may have
subprojects, which are themselves full projects. You have to be an
OBS admin to create a root-level project, so our project (`Rancher`)
was created as a subproject of the `isv` root project. Projects are
referred to as each of their parent projects plus their name, all
separated by colons. So to refer to our top-level project, you use
the name `isv:Rancher`.

A **repository** is configured on a project. The best way to think of
repositories is in the context of package managers: they are a remote
endpoint from which you can download packages. There are several types of
repositories - some are true repositories in the sense that tools like
`apt` and `dnf` can be configured to use them, and others are just endpoints
you can download assets from. Also, you can configure multiple repositories
on each project. This is useful for building and serving packages of multiple
formats from the same binary or source code.

A **package** is also configured on a project. Conceptually, OBS packages
are different from packages in other contexts. In OBS, a package represents
a set of files that go into a build, such as source files and any package
metadata files (such as rpm `.spec` files). Also, from the perspective of the
user's package manager, an OBS package represents exactly one version of the
package. So if you want to provide multiple versions of the package in each
repository, you must have one OBS package for each version.

A **service** is basically a script that can be triggered in a few different
ways. A common use for services is to get the latest version of code from
version control before building and packaging that code. For more information
on services see below; also, you may find the
[documentation for services][service_documentation] helpful.

[service_documentation]: https://openbuildservice.org/help/manuals/obs-user-guide/cha.obs.source_service.html#sec.obs.sserv.about


## Service Tips

### Update your services to the latest versions

Before doing anything with services, you should ensure that you have installed
the latest versions of any services you want to work with. This is important
because the remote version of OBS (build.opensuse.org) always uses the latest
version of services - if you are working with a different version on your local
machine, you may run into issues. Also note that services do not always (ever?)
use semantic versioning despite having versions of the form `X.Y.Z`.

The repositories that openSUSE comes configured with do not contain the latest
versions of the OBS services. In order to get the latest versions you need to
add a repository:

```
zypper addrepo https://download.opensuse.org/repositories/openSUSE:/Tools/openSUSE_15.3/openSUSE:Tools.repo
zypper refresh
```

After you do this you can install/update the services you need. If you aren't
on Leap 15.3, you may have to find a different version of this repo, but this
is what works at the time of writing.

### How to find out what services are available

Services come in the form of rpm packages that can be installed via `zypper`.
In order to search your installed repos for services, simply run:

```
zypper search obs-service
```

### How to find out what configuration each service takes

Once services are installed you can look at their interface schema in order
to understand how to use them. The interface schema (as well as the source code)
are stored in the directory `/usr/lib/obs/service/`.


## Local Build Tips

### How to get around slow mirrors

When you do a local build, the first thing `osc` does is cache any dependencies
of the build. `osc` will download these dependencies from mirrors of their
repositories. Unfortunately these mirrors can be very slow. If the dependency
caching step is too slow, you can tell `osc build` to only fetch packages from
the build.opensuse.org api with the `--download-api-only` flag.

### How to skip running services before build

Use the `--no-service` flag on `osc build` for this.

### How to find the output of a local build

When you build locally, it is not always obvious where the output of the build
has been saved. To find the location of your build output, look at the text that
the build has printed at the screen. At the end of it there should be a path;
this is where you can find your built package.


## Additional Resources

- The `help-obs` and `discuss-zypp` slack channels are always friendly and helpful.
- The [OBS documentation][obs_docs] might help resolve any problems you run into.
- The output of `osc --help` and `osc <command> --help` may be helpful.

[obs_docs]: https://openbuildservice.org/help/manuals/obs-user-guide/
