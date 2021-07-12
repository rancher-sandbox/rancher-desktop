'use strict';

const os = require('os');
const path = require('path');
const { app } = require('electron');
const memoize = require('lodash/memoize');
const adjustNameWithDir = {
  helm:    path.join('bin', 'helm'),
  kim:     path.join('bin', 'kim'),
  kubectl: path.join('bin', 'kubectl'),
  trivy:   path.join('bin', 'trivy'),
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

function _wslify(path) {
  const m = /^(\w):(.+)$/.exec(path);

  if (!m) {
    return path;
  }

  return `/mnt/${ m[1].toLowerCase() }${ m[2].replace(/\\/g, '/') }`;
}
const wslify = memoize(_wslify);

module.exports = {
  get, executable, wslify
};
