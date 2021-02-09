'use strict';

const process = require('process');
const pth = require('path');
const fs = require('fs');
const k8s = require('@kubernetes/client-node');

// Get the path to the kubeconfig file. This is dependent on where this is run.
function path() {
  if (process.env.KUBECONFIG && process.env.KUBECONFIG.length > 0) {
    const files = process.env.KUBECONFIG.split(pth.delimiter);
    // Only returning the path to the first file if there are multiple.
    return files[0];
  }

  const home = k8s.findHomeDir();
  if (home) {
    const cfg = pth.join(home, '.kube', 'config');
    if (hasAccess(cfg)) {
      return cfg;
    }
  }

  // TODO: Handle WSL

  return '';
}

exports.path = path;

function hasAccess(pth) {
  try {
    fs.accessSync(pth);
    return true;
  } catch (err) {
    return false;
  }
}
