import fs from 'fs';
import http from 'http';
import path from 'path';

import { app } from 'electron';

const host = 'localhost';
const port = 6120;

const STATIC_PATH = path.join(app.getAppPath(), 'resources', 'rancher-dashboard');

const MIME_TYPES: Record<string, string> = {
  html: 'text/html; charset=UTF-8',
  js:   'application/javascript; charset=UTF-8',
  css:  'text/css',
  json: 'application/json',
  png:  'image/png',
  jpg:  'image/jpeg',
  jpeg: 'image/jpeg',
  ico:  'image/x-icon',
  svg:  'image/svg+xml',
};

const serveFile = (name: string) => {
  const filePath = path.join(STATIC_PATH, name);

  if (!filePath.startsWith(STATIC_PATH)) {
    console.log(`Can't be served: ${ name }`);

    return null;
  }
  const stream = fs.createReadStream(filePath);

  console.log(`Served: ${ name }`);

  return stream;
};

export const init = () => {
  http
    .createServer((req, res) => {
      const { url } = req;

      if (req.method === 'GET') {
        const fileExt = path.extname(url || '').substring(1);
        const mimeType = MIME_TYPES[fileExt] || MIME_TYPES.html;

        res.writeHead(200, { 'Content-Type': mimeType });
        const stream = fileExt === '' ? serveFile('/index.html') : serveFile(url || '');

        if (stream) {
          stream.pipe(res);
        }
      }
    })
    .listen(port, host);
};
