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
      let param = `--${ k }`;

      if (options[k] !== undefined) {
        param += `=${ options[k] }`;
      }
      args.push(param);
    }
    const childProcess = spawn(resources.executable('/bin/helm'), args);
    let stdout = '';
    let stderr = '';

    childProcess.stdout.on('data', data => (stdout += data.toString()));
    childProcess.stderr.on('data', data => (stderr += data.toString()));
    childProcess.on('exit', code => {
      if (code !== 0) {
        reject(new Error(stderr));
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
 * @param {string?} namespace The namespace to list.
 * @returns {Promise<Object>} the parsed JSON for a Helm list
 */
async function list(namespace) {
  const options = { output: 'json', 'kube-context': 'rancher-desktop' };

  if (namespace !== undefined) {
    options.namespace = namespace;
  }
  try {
    return await exec(options, 'ls');
  } catch (err) {
    const nsText = namespace ? ` in namespace ${ namespace }` : '';

    throw new Error(`Failed to list releases${ nsText }: ${ err?.message || err }`);
  }
}

/**
 * Get the status of a release
 *
 * @param {string} name The name of the Helm release
 * @param {string} namespace The namespace the Helm release is in
 * @returns {Promise<Object>} the parsed JSON for a Helm status command
 */
async function status(name, namespace) {
  if (name === undefined) {
    throw new Error('name required to get status');
  }
  const options = { output: 'json', 'kube-context': 'rancher-desktop' };

  if (namespace !== undefined) {
    options.namespace = namespace;
  }
  try {
    return await exec(options, 'status', name);
  } catch (err) {
    const target = `${ namespace ? `${ namespace }:` : '' }${ name }`;

    throw new Error(`Failed to get status of release ${ target }: ${ err?.message || err }`);
  }
}

/**
 * Install a Helm chart into a Kubernetes cluster
 *
 * @param {string} name The release name to use
 * @param {string} chart The chart to install
 * @param {string} namespace The namespace to install the chart in to
 * @param {boolean} createNamespace If Helm should create the namespace
 * @returns {Promise<Object>} the parsed JSON for a Helm install command
 */
async function install(name, chart, namespace, createNamespace) {
  if (name === undefined) {
    throw new Error('name required to install');
  }
  if (chart === undefined) {
    throw new Error('chart required to install');
  }
  const options = {
    output: 'json', 'kube-context': 'rancher-desktop', wait: undefined
  };

  if (namespace !== undefined) {
    options.namespace = namespace;
  }
  if (createNamespace) {
    options['create-namespace'] = undefined;
  }
  try {
    return await exec(options, 'install', name, chart);
  } catch (err) {
    const target = `${ namespace ? `${ namespace }:` : '' }${ name }`;

    throw new Error(`Failed to install chart ${ target }: ${ err?.message || err }`);
  }
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
  } catch (err) {
    // If the exception matches these, that means the chart wasn't installed
    const exprs = [
      /^Error: uninstall: Release not loaded:/,
      /^Failed to purge the release: release: not found$/,
    ];

    if (exprs.some(expr => expr.test(err.message))) {
      return;
    }
    const target = `${ namespace ? `${ namespace }:` : '' }${ name }`;

    throw new Error(`Failed to uninstall chart ${ target }: ${ err.message }`);
  }
}

module.exports = {
  list, status, install, uninstall
};
if (process.env.NODE_ENV === 'test') {
  module.exports.exec = exec;
}
