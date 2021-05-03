# Images

Rancher Desktop provides the ability to build, push, and pull images via the
[KIM](https://github.com/rancher/kim) project.

Note, on Mac `kim` is put into the path. This feature is not yet working on
Windows and you will need to either manually add the binary to your path or
install KIM directly. Adding KIM to your path is coming soon.

## Using KIM

You can learn about all of the command options by running `kim -h`. This will
display the help documentation.

KIM has a client side and server side component. The server side part is a
container running in Kubernetes while the client side application runs on
Mac or Windows. Images are stored in the same containerd that Kubernetes uses.

## Building Images

Building images has a similar feel to existing tools. For example, consider
running `kim` from a directory with a `Dockerfile` where the `Dockerfile` is
using a scratch image.

```console
❯ kim build .
[+] Building 0.1s (4/4) FINISHED
 => [internal] load build definition from Dockerfile
 => => transferring dockerfile: 31B
 => [internal] load .dockerignore
 => => transferring context: 2B
 => [internal] load build context
 => => transferring context: 33B
 => CACHED [1/1] ADD anvil-app /
 ```

`kim` has tags for tagging at the same time as building and other options you've
come to expect.

If you want to tag an existing image you've built you can use the `kim tag`
command.
