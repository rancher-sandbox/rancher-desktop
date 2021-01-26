'use strict';

const { app } = require('electron');
const os = require('os');
const path = require('path');
const fs = require('fs');

/**
 * Get the path to a resource file
 * @param  {...String} pathParts Path relative to the resource directory
 */
function get(...pathParts) {
    if (app.isPackaged) {
        return path.join(process.resourcesPath, 'resources', ...pathParts);
    }
    return path.join(app.getAppPath(), '..', '..', 'resources', ...pathParts);
}

/**
 * Get the path to an executable binary
 * @param {String} name The name of the binary, without file extension.
 */
function executable(name) {
    let execPath = get(os.platform(), /^win/i.test(os.platform()) ? `${name}.exe` : name);
    if (fs.existsSync(execPath)) {
      return execPath;
    }
    let parts = path.parse(execPath);
    return path.join(parts.dir, 'bin', parts.base);
}

module.exports = { get, executable };
