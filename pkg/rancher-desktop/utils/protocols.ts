import path from 'path';
import { URL, pathToFileURL } from 'url';

import Electron from 'electron';

import mainEvents from '@pkg/main/mainEvents';
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
  if (Electron.app.isPackaged) {
    return path.join(Electron.app.getAppPath(), 'dist', 'app', relPath);
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
  Electron.protocol.handle(
    'app',
    (request) => {
      const relPath = new URL(request.url).pathname;
      const redirectUrl = redirectedUrl(relPath);

      if (isDevBuild) {
        return Electron.net.fetch(redirectUrl);
      }

      return Electron.net.fetch(pathToFileURL(redirectUrl).toString());
    });
}

/**
 * Set up protocol handler for x-rd-extension://
 *
 * This handler is used for extensions; the format is:
 * x-rd-extension://<extension id>/...
 * Where the extension id is the extension image id, hex encoded (to avoid
 * issues with slashes).  Base64 was not available in Vue.
 * @param partition The Electron session partition name; if unset, set it up for
 *                  the default session.
 */
function setupExtensionProtocolHandler(partition?: string): Promise<void> {
  const scheme = 'x-rd-extension';
  const session = partition ? Electron.session.fromPartition(partition) : Electron.session.defaultSession;

  if (!session.protocol.isProtocolHandled(scheme)) {
    session.protocol.handle(
      scheme,
      (request) => {
        const url = new URL(request.url);
        // Re-encoding the extension ID here also ensures it doesn't contain any
        // directory traversal etc. issues.
        const extensionID = Buffer.from(url.hostname, 'hex').toString('base64url');
        const resourcePath = path.normalize(url.pathname);
        const filepath = path.join(paths.extensionRoot, extensionID, resourcePath);

        return Electron.net.fetch(pathToFileURL(filepath).toString());
      });
  }

  return Promise.resolve();
}

export function setupProtocolHandlers() {
  try {
    setupAppProtocolHandler();
    setupExtensionProtocolHandler();
    mainEvents.handle('extensions/register-protocol', setupExtensionProtocolHandler);

    protocolsRegistered.resolve();
  } catch (ex) {
    console.error('Error registering protocol handlers:', ex);
  }
}
