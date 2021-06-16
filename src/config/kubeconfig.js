'use strict';

const process = require('process');
const pth = require('path');
const fs = require('fs');
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
    const kube = pth.join(home, '.kube');
    const cfg = pth.join(kube, 'config');

    if (!hasAccess(cfg)) {
      if (!hasAccess(kube)) {
        console.log(`creating dir ${ kube }`);
        fs.mkdirSync(kube);
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
