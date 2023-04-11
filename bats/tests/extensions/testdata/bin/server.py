#!/usr/bin/env python3

# This is a simple Python HTTP server listening on the Unix socket
# `/run/guest-services/hello.sock` (see `everything.json`) to exercise the
# ability for the front end to talk to the back end.

from http import server
import os
import socketserver


class RequestHandler(server.SimpleHTTPRequestHandler):
  def __init__(self, *args, **kwargs):
    super().__init__(*args, **kwargs, directory="/")

  def address_string(self):
    # SimpleHTTPRequestHandler assumes TCP; fix up the client address if it's
    # just a string (because Unix socket).
    if isinstance(self.client_address, str):
      self.client_address = [self.client_address, 0]
    return super().address_string()


if __name__ == '__main__':
  addr = '/run/guest-services/hello.sock'
  try:
    os.unlink(addr)
  except Exception as ex:
    print(ex)

  print("Starting HTTP server...")
  with socketserver.ThreadingUnixStreamServer(addr, RequestHandler) as httpd:
    print(f"Serving HTTP on {addr}")
    try:
      httpd.serve_forever()
    except KeyboardInterrupt:
      print("\nexiting...")
      pass
