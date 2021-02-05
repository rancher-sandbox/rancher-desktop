'use strict';

const { app } = require('electron');
const os = require('os');
const path = require('path');
const memoize =  require('lodash/memoize');

/**
 * Get the path to a resource file
 * @param  {...String} pathParts Path relative to the resource directory
 */
function get(...pathParts) {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'resources', ...pathParts);
  }
  return path.join(app.getAppPath(), 'resources', ...pathParts);
}

/**
 * Get the path to an executable binary
 * @param {String} name The name of the binary, without file extension.
 */
function _executable(name) {
  return get(os.platform(), /^win/i.test(os.platform()) ? `${name}.exe` : name);
}
const executable = memoize(_executable);

module.exports = { get, executable };
