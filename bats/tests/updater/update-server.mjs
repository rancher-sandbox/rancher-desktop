/**
 * A stand-in for the Upgrade Responder and the GitHub releases API, so that an
 * upgrade can be driven end-to-end without publishing a release or downloading
 * hundreds of megabytes.
 *
 * The updater only checks the size and the checksum of the asset it fetches, so
 * the "installer" this serves is a handful of bytes. Nothing installs it: the
 * test asserts that the download completed, which is as far as the updater gets
 * before the user restarts the application.
 *
 * Usage: node update-server.mjs <url-file> [<trace-file>]
 * Prints nothing; writes its base URL to <url-file> once it is listening, and
 * appends one line per request to <trace-file>, which records how far the
 * updater got when an assertion fails without one.
 */

import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';

/** Higher than any real release, so the running version always wants it. */
const version = '9.9.9';
const tag = `v${ version }`;

/**
 * The updater picks the asset for the platform it runs on. This names the asset
 * from the architecture of the node running the server, so an x64 node on an
 * arm64 host offers one the application will not accept.
 */
function assetName() {
  switch (process.platform) {
  case 'darwin':
    return `Rancher.Desktop-${ version }-mac.${ process.arch === 'arm64' ? 'aarch64' : 'x86_64' }.zip`;
  case 'linux':
    return `rancher-desktop-linux-${ version }.AppImage`;
  case 'win32':
    return `Rancher.Desktop.Setup.${ version }.msi`;
  }
  throw new Error(`No asset name for platform ${ process.platform }`);
}

const name = assetName();
const asset = Buffer.from('Rancher Desktop simulated upgrade');
const checksum = `${ crypto.createHash('sha512').update(asset).digest('hex') }  ${ name }\n`;

function send(response, status, body, type = 'application/json') {
  response.writeHead(status, { 'content-type': type, 'content-length': Buffer.byteLength(body) });
  response.end(body);
}

const traceFile = process.argv[3];

const server = http.createServer((request, response) => {
  const base = `http://${ request.headers.host }`;
  const { pathname } = new URL(request.url, base);

  if (traceFile) {
    fs.appendFileSync(traceFile, `${ request.method } ${ pathname }\n`);
  }

  // Drain the body of the Upgrade Responder's POST; we answer the same either way.
  request.resume();

  if (pathname.endsWith('/checkupgrade')) {
    return send(response, 200, JSON.stringify({
      versions:                 [{ Name: version, ReleaseDate: '2038-01-01T00:00:00Z', Supported: true, Tags: ['latest'] }],
      requestIntervalInMinutes: 60,
    }));
  }

  // Answer for whatever owner/repo the update config names.
  if (pathname.endsWith(`/releases/tags/${ tag }`)) {
    return send(response, 200, JSON.stringify({
      url:          `${ base }/releases/1`,
      id:           1,
      tag_name:     tag,
      name:         `Rancher Desktop ${ version }`,
      body:         'Simulated release.',
      draft:        false,
      prerelease:   false,
      published_at: '2038-01-01T00:00:00Z',
      assets:       [
        {
          url: '', browser_download_url: `${ base }/assets/${ name }`, id: 1, name, label: '', size: asset.length,
        },
        {
          url: '', browser_download_url: `${ base }/assets/${ name }.sha512sum`, id: 2, name: `${ name }.sha512sum`, label: '', size: Buffer.byteLength(checksum),
        },
      ],
    }));
  }

  if (pathname === `/assets/${ name }`) {
    return send(response, 200, asset, 'application/octet-stream');
  }
  if (pathname === `/assets/${ name }.sha512sum`) {
    return send(response, 200, checksum, 'text/plain');
  }

  // electron-updater probes for a differential-download block map; saying no
  // makes it fall back to fetching the whole asset.
  send(response, 404, JSON.stringify({ message: `No such path ${ pathname }` }));
});

server.listen(0, '127.0.0.1', () => {
  const { port } = server.address();

  fs.writeFileSync(process.argv[2], `http://127.0.0.1:${ port }`);
});
