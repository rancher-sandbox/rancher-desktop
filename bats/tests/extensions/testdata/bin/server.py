#!/usr/bin/env python3

# This is a simple Python HTTP server listening on the Unix socket
# `/run/guest-services/hello.sock` (see `everything.json`) to exercise the
# ability for the front end to talk to the back end.

from functools import partial
from http import server
import os
import signal
import socketserver
import sys


class RequestHandler(server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs, directory="/")

    def address_string(self):
        # SimpleHTTPRequestHandler assumes TCP; fix up the client address if it's
        # just a string (because Unix socket).
        if isinstance(self.client_address, str):
            self.client_address = [self.client_address, 0]
        return super().address_string()


def make_unix_socket_server():
    addr = '/run/guest-services/hello.sock'
    try:
        os.unlink(addr)
    except Exception as ex:
        print(ex)
    httpd = socketserver.ThreadingUnixStreamServer(addr, RequestHandler)
    return (addr, httpd)


def make_tcp_server():
    handler_class = partial(server.SimpleHTTPRequestHandler,
                            directory="/")
    httpd = server.ThreadingHTTPServer(("", 0), handler_class)
    host, port = httpd.socket.getsockname()[:2]
    addr = f"http://{host}:{port}"
    return (addr, httpd)


if __name__ == '__main__':
    signal.signal(signal.SIGTERM, lambda *args: sys.exit(0))
    signal.signal(signal.SIGINT, lambda *args: sys.exit(0))
    try:
        print("Starting HTTP server...")
        try:
            addr, httpd = make_unix_socket_server()
        except FileNotFoundError:
            addr, httpd = make_tcp_server()
        print(f"Serving HTTP on {addr}")
        httpd.serve_forever()

    except SystemExit:
        print("\nexiting...")
