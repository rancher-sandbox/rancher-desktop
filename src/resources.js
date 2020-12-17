/**
 * Helper package to locate extra (non-renderer) resources
 */

'use strict';

const os = require('os');
const path = require('path');
const { app } = require('electron');

/**
 * Given a path relative to the "resources" directory in the source tree.
 * @param {String[]} resourcePath
 */
function get(...resourcePath) {
    let root = app.isPackaged ? process.resourcesPath : path.dirname(__dirname);
    return path.join(root, "resources", ...resourcePath);
}

/**
 * Get an icon resource, given its file name (with extension).
 * @param {String} name
 */
function getIcon(name) {
    return get("icons", name);
}

/**
 * Get the path to an executable, given its name (without extension).
 * @param {String} name
 */
function getExecutable(name) {
    if (/^win/i.test(os.platform())) {
        name += ".exe";
    }
    return get(os.platform(), name);
}

module.exports = { getIcon, getExecutable };
