import path from 'path';
import { URL, pathToFileURL } from 'url';

import { app, protocol, net } from 'electron';

import { isDevBuild } from '@pkg/utils/environment';
import Latch from '@pkg/utils/latch';
import Logging from '@pkg/utils/logging';
import paths from '@pkg/utils/paths';

const console = Logging['protocol-handler'];

/**
 * Create a URL that consists of a base combined with the provided path
 * @param relPath The destination path for the requested resource
 * @returns A URL that consists of the combined base (http://localhost:8888)
 * and provided path
 */
function redirectedUrl(relPath: string) {
  if (isDevBuild) {
    return `http://localhost:8888${ relPath }`;
  }
  if (app.isPackaged) {
    return path.join(app.getAppPath(), 'dist', 'app', relPath);
  }

  // Unpackaged non-dev build; this normally means E2E tests, where
  // `app.getAppPath()` is `.../dist/app.
  return path.join(process.cwd(), 'dist', 'app', relPath);
}

// Latch that is set when the app:// protocol handler has been registered.
// This is used to ensure that we don't attempt to open the window before we've
// done that, when the user attempts to open a second instance of the window.
export const protocolsRegistered = Latch();

/**
 * Set up protocol handler for app://
 * This is needed because in packaged builds we'll not be allowed to access
 * file:// URLs for our resources. Use the same app:// protocol for both dev and
 * production environments.
 */
function setupAppProtocolHandler() {
  protocol.handle(
    'app',
    (request) => {
      const relPath = new URL(request.url).pathname;
      const redirectUrl = redirectedUrl(relPath);

      if (isDevBuild) {
        return net.fetch(redirectUrl);
      }

      return net.fetch(pathToFileURL(redirectUrl).toString());
    });
}

/**
 * Set up protocol handler for x-rd-extension://
 *
 * This handler is used for extensions; the format is:
 * x-rd-extension://<extension id>/...
 * Where the extension id is the extension image id, hex encoded (to avoid
 * issues with slashes).  Base64 was not available in Vue.
 */
function setupExtensionProtocolHandler() {
  protocol.handle(
    'x-rd-extension',
    (request) => {
      const url = new URL(request.url);
      // Re-encoding the extension ID here also ensures it doesn't contain any
      // directory traversal etc. issues.
      const extensionID = Buffer.from(url.hostname, 'hex').toString('base64url');
      const resourcePath = path.normalize(url.pathname);
      const filepath = path.join(paths.extensionRoot, extensionID, resourcePath);

      return net.fetch(pathToFileURL(filepath).toString());
    });
}

export function setupProtocolHandlers() {
  try {
    setupAppProtocolHandler();
    setupExtensionProtocolHandler();

    protocolsRegistered.resolve();
  } catch (ex) {
    console.error('Error registering protocol handlers:', ex);
  }
}
