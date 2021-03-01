'use strict';

const { app, BrowserWindow } = require('electron');

/**
 * A mapping of window key (which is our own construct) to a window ID (which is
 * assigned by electron).
 * @type Object<string, number>
 */
const windowMapping = {};

/**
 * Open a given window; if it is already open, focus it.
 * @param {string} name The window identifier; this controls window re-use.
 * @param {string} url The URL to load into the window.
 * @param {Electron.WebPreferences} prefs Options to control the new window.
 */
function createWindow(name, url, prefs) {
  let window = (name in windowMapping) ? BrowserWindow.fromId(windowMapping[name]) : null;

  if (window) {
    if (!window.isFocused()) {
      window.show();
    }

    return;
  }

  window = new BrowserWindow({
    width: 940, height: 600, webPreferences: prefs
  });
  window.loadURL(url);
  windowMapping[name] = window.id;
}

/**
 * Open the preferences window; if it is already open, focus it.
 */
function openPreferences() {
  let url = 'app://./index.html';

  if (/^dev/i.test(process.env.NODE_ENV)) {
    url = 'http://localhost:8888/';
  }
  createWindow('preferences', url, { nodeIntegration: true });
}

/**
 * Open the dashboard window; if it is already open, focus it.
 * @param {number} port The port that the dashboard is listening on; it is
 *                      expected to be available on localhost.
 */
function openDashboard(port) {
  createWindow('dashboard', `https://localhost:${ port }/`, { sandbox: true });
}

/**
 * Open the Stratos window; if it is already open, focus it.
 * @param {number} port The port number for Stratos.
 */
function openStratos(port) {
  createWindow('stratos', `https://localhost:${ port }/`, { nodeIntegration: true });
}

/**
 * Close the dashboard window, if it is already open.
 */
function closeDashboard() {
  if (!('dashboard' in windowMapping)) {
    return;
  }
  BrowserWindow.fromId(windowMapping.dashboard)?.close();
}

// Set up a certificate error handler to ignore any certificate errors coming
// from the dashboard or stratos windows.  This is necessary as these things we
// run internally use self-signed certificates.
app.on('certificate-error', (event, webContents, url, error, cert, callback) => {
  console.log(`Certificate error on ${ url } from issuer ${ cert?.issuerCert?.fingerprint || cert?.issuerName }`);
  for (const [windowName, windowId] of Object.entries(windowMapping)) {
    if (webContents !== BrowserWindow.fromId(windowId)?.webContents) {
      continue;
    }
    console.log(`... From window ${ windowName }`);
    if (['dashboard', 'stratos'].includes(windowName)) {
      console.log('... Accepted.');
      // Ignore certificate errors from this window
      event.preventDefault();
      // Disable the lint here, as this is not a node-style callback with error
      // as the first argument.
      /* eslint-disable node/no-callback-literal */
      callback(true);
    }
  }
});

/**
 * Send a message to all windows in the renderer process.
 * @param {string} channel The channel to send on.
 * @param  {...any} args Any arguments to pass.
 */
function send(channel, ...args) {
  for (const windowId of Object.values(windowMapping)) {
    const window = BrowserWindow.fromId(windowId);

    window?.webContents?.send(channel, ...args);
  }
}

module.exports = {
  openPreferences, openDashboard, openStratos, closeDashboard, send
};
