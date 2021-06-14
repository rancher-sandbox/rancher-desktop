'use strict';

const os = require('os');
const path = require('path');
const { app } = require('electron');
const memoize = require('lodash/memoize');
const adjustNameWithDir = {
  helm:    path.join('bin', 'helm'),
  kim:     path.join('bin', 'kim'),
  kubectl: path.join('bin', 'kubectl'),
  kuberlr: path.join('bin', 'kuberlr'),
};

function fixedSourceName(name) {
  return adjustNameWithDir[name] || name;
}

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
  const adjustedName = fixedSourceName(name);

  return get(os.platform(), /^win/i.test(os.platform()) ? `${ adjustedName }.exe` : adjustedName);
}
const executable = memoize(_executable);

module.exports = { get, executable };
