'use strict';

const { spawn } = require('child_process');
const resources = require('../resources');

/**
 * Execute helm and return the result.  If the helm executable returns a
 * non-zero exit code, an exception is raised with the contents of stderr.  If
 * the `output` option is set to `json`, then the output will be parsed as JSON.
 * @param {Object.<string, string|void>} options Parameters for the helm executable.
 * @param {string[]} command Arguments for the helm executable.
 * @returns {Promise<Object|string>} Return value from helm.
 */
function exec(options = {}, ...args) {
  return new Promise((resolve, reject) => {
    for (const k in options) {
      let param = `--${k}`;
      if (options[k] !== undefined) {
        param += `=${options[k]}`;
      }
      args.push(param);
    }
    const childProcess = spawn(resources.executable('/bin/helm'), args);
    let stdout = '';
    let stderr = '';
    childProcess.stdout.on('data', data => stdout += data.toString());
    childProcess.stderr.on('data', data => stderr += data.toString());
    childProcess.on('exit', code => {
      if (code !== 0) {
        reject(stderr);
      } else if (/^json$/i.test(options?.output)) {
        resolve(JSON.parse(stdout));
      } else {
        resolve(stdout);
      }
    });
  });
}

/**
 * List returns the current Helm releases in a namespace. If no namespace is
 * provided the current default is used. It is recommended that you provide a
 * namespace.
 *
 * @param {string} namespace
 * @returns {object} the parsed JSON for a Helm list
 */
function list(namespace) {
  return new Promise((resolve, reject) => {
    let dta = '';
    let err = '';
    const args = ['ls', '--kube-context', 'rancher-desktop', '-o', 'json'];
    if (namespace !== undefined) {
      args.push('--namespace', namespace);
    }
    const bat = spawn(resources.executable('/bin/helm'), args);

    bat.stdout.on('data', data => {
      dta += data.toString();
    });

    bat.stderr.on('data', data => {
      err += data.toString();
    });

    bat.on('exit', code => {
      if (code === 0) {
        resolve(JSON.parse(dta));
      } else {
        reject('Failed to list resource: ' + err);
      }
    });
  });
}

/**
 * Get the status of a release
 *
 * @param {string} name The name of the Helm release
 * @param {string} namespace The namespace the Helm release is in
 * @returns {object} the parsed JSON for a Helm status command
 */
function status(name, namespace) {
  return new Promise((resolve, reject) => {
    if (name === undefined) {
      reject('name required to get status');
    }

    let dta = '';
    let err = '';
    const args = ['status', name, '--kube-context', 'rancher-desktop', '-o', 'json'];
    if (namespace !== undefined) {
      args.push('--namespace', namespace);
    }

    const bat = spawn(resources.executable('/bin/helm'), args);

    bat.stdout.on('data', data => {
      dta += data.toString();
    });

    bat.stderr.on('data', data => {
      err += data.toString();
    });

    bat.on('exit', code => {
      if (code === 0) {
        resolve(JSON.parse(dta));
      } else {
        reject('Failed to list resource: ' + err);
      }
    });
  });
}

/**
 * Install a Helm chart into a Kubernetes cluster
 *
 * @param {string} name The release name to use
 * @param {string} chart The chart to install
 * @param {string} namespace The namespace to install the chart in to
 * @param {boolean} createNamespace If Helm should create the namespace
 * @returns {object} the parsed JSON for a Helm install command
 */
function install(name, chart, namespace, createNamespace) {
  return new Promise((resolve, reject) => {
    if (name === undefined) {
      reject('name required to install');
    }
    if (chart === undefined) {
      reject('chart required to install');
    }

    let dta = '';
    let err = '';
    const args = ['install', name, chart, '--kube-context', 'rancher-desktop', '-o', 'json', '--wait'];
    if (namespace !== undefined) {
      args.push('--namespace', namespace);
    }
    if (createNamespace) {
      args.push('--create-namespace');
    }

    // TODO: There is a lot of repeated code in this file. It could be simplified.
    const bat = spawn(resources.executable('/bin/helm'), args);

    bat.stdout.on('data', data => {
      dta += data.toString();
    });

    bat.stderr.on('data', data => {
      err += data.toString();
    });

    bat.on('exit', code => {
      if (code === 0) {
        resolve(JSON.parse(dta));
      } else {
        reject('Failed to list resource: ' + err);
      }
    });
  });
}

/**
 * Uninstall a helm release from a Kubernetes cluster.
 * If the release was already not installed, no error occurs.
 *
 * @param {string} name The release name to uninstall.
 * @param {string|void} namespace The namespace to uninstall from.
 */
async function uninstall(name, namespace) {
  if (name === undefined) {
    throw new Error('name required to uninstall');
  }
  const opts = { 'kube-context': 'rancher-desktop' };
  if (namespace !== undefined) {
    opts.namespace = namespace;
  }

  try {
    // `helm uninstall` doesn't support `--output=json`
    await exec(opts, 'uninstall', name);
  } catch (ex) {
    // If the exception matches these, that means the chart wasn't installed
    const exprs = [
      /^Error: uninstall: Release not loaded:/,
      /^Failed to purge the release: release: not found$/,
    ];
    if (exprs.some(expr => expr.test(ex.toString()))) {
      return;
    }
    throw ex;
  }
}

module.exports = { list, status, install, uninstall };
