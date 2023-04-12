# extension-proxy

This program is used to forward HTTP requests from the extension frontend to the
extension backend.  The frontend makes a HTTP request using a relative URL
(doing something like `ddClient.extension.vm.service.get('/foo')`), which must
be routed to the backend listening on a Unix socket.  This program is used to
handle the forwarding from some TCP port into that Unix socket.

The environment variable `SOCKET` should be set to the path of a Unix socket,
which will be forwarded to port 80.  Typically this would be set to the name of
a socket in `/run/guest-services/`, which is then shared (via a volume) with
other containers.
