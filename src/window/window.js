'use strict';

const { app, BrowserWindow } = require('electron');

/**
 * A mapping of window key (which is our own construct) to a window ID (which is
 * assigned by electron).
 * @type Object<string, number>
 */
let windowMapping = {};

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

  window = new BrowserWindow({ width: 940, height: 600, webPreferences: prefs });
  window.loadURL(url);
  windowMapping[name] = window.id;
}

/**
 * Open the preferences window; if it is already open, focus it.
 */
function openPreferences() {
  let url = 'app://./index.html';
  if (/^dev/i.test(process.env.NODE_ENV)) {
    url = 'http://localhost:8080/';
  }
  createWindow('preferences', url, { nodeIntegration: true });
}

/**
 * Open the dashboard window; if it is already open, focus it.
 * @param {number} port The port that the dashboard is listening on; it is
 *                      expected to be available on localhost.
 */
function openDashboard(port) {
  createWindow('dashboard', `https://localhost:${port}/`, { sandbox: true });
}

// Set up a certificate error handler to ignore any certificate errors coming
// from the dashboard window.  This is necessary as the dashboard we run
// internally uses a self-signed certificate.
app.on('certificate-error', (event, webContents, url, error, cert, callback) => {
  console.log(`Certificate error on ${url} from issuer ${cert?.issuerCert?.fingerprint || cert?.issuerName}`);
  if (!('dashboard' in windowMapping)) {
    console.log(`... No contents (${webContents}) or mapping (${JSON.stringify(windowMapping)}), skipping.`);
    return;
  }
  if (webContents !== BrowserWindow.fromId(windowMapping.dashboard)?.webContents) {
    console.log(`... Incorrect web contents from ${BrowserWindow.fromId(windowMapping.dashboard)?.webContents}, skipping.`);
    return;
  }
  console.log(`... Accepted.`);
  // Ignore certificate errors for the dashboard window
  event.preventDefault();
  callback(true);
});

/**
 * Send a message to the renderer process.
 * @param {string} channel The channel to send on.
 * @param  {...any} args Any arguments to pass.
 */
function send(channel, ...args) {
  window.webContents.send(channel, ...args);
}

module.exports = { openPreferences, openDashboard, send };
