'use strict';

const fs = require('fs');
const pth = require('path');

const k8s = require('@kubernetes/client-node');

// Get the path to the kubeconfig file. This is dependent on where this is run.
function path() {
  if (process.env.KUBECONFIG && process.env.KUBECONFIG.length > 0) {
    const files = process.env.KUBECONFIG.split(pth.delimiter).filter(hasAccess);

    // Only returning the path to the first file if there are multiple.
    if (files.length) {
      return files[0];
    }
  }

  const home = k8s.findHomeDir();

  if (home) {
    const kubeDir = pth.join(home, '.kube');
    const cfg = pth.join(kubeDir, 'config');

    if (!hasAccess(cfg)) {
      if (!hasAccess(kubeDir)) {
        console.log(`creating dir ${ kubeDir }`);
        fs.mkdirSync(kubeDir);
      }
      console.log(`creating file ${ cfg }`);
      fs.writeFileSync(cfg, JSON.stringify({
        apiVersion:        'v1',
        clusters:          [],
        contexts:          [],
        'current-context': null,
        kind:              'Config',
        preferences:       {},
        users:             [],
      }, undefined, 2), { mode: 0o600 });
    }

    return cfg;
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

exports.hasAccess = hasAccess;
