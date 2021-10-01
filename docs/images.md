# Images

Rancher Desktop provides the ability to build, push, and pull images via the
[NERDCTL](https://github.com/containerd/nerdctl) project.

Note, `nerdctl` is put into the path automatically.  This occurs during the
installer on Windows, and upon first run on macOS.

## Using NERDCTL

You can learn about all of the command options by running `nerdctl -h`. This will
display the help documentation. The command requires Rancher Desktop to be running
for it to work.

The initial set of images are stored in the same containerd that Kubernetes uses,
and are part of the `k8s.io` namespace. You can also switch to a namespace called
`default` if you wish to build or pull images into a different namespace. Currently
the only way to create other namespaces is to build or pull an image with the
`nerdctl` CLI, using the `--namespace <NAMESPACE_NAME>` option.

## Building Images

Building images has a similar feel to existing tools. For example, consider
running `kim` from a directory with a `Dockerfile` where the `Dockerfile` is
using a scratch image.

```console
❯ nerdctl build .
[+] Building 0.1s (4/4) FINISHED
 => [internal] load build definition from Dockerfile
 => => transferring dockerfile: 31B
 => [internal] load .dockerignore
 => => transferring context: 2B
 => [internal] load build context
 => => transferring context: 33B
 => CACHED [1/1] ADD anvil-app /
 ```

`nerdctl` has tags for tagging at the same time as building and other options you've
come to expect.

If you want to tag an existing image you've built you can use the `nerdctl tag`
command.
