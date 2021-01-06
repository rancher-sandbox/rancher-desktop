'use strict';

const { spawn } = require('child_process');
const os = require('os');

/*
 * List returns the current Helm releases in a namespace. If no namespace is
 * provided the current default is used. It is recommended that you provide a
 * namespace.
 * 
 * @param {string} namespace
 * @returns {object} the parsed JSON for a Helm list
 */
function list(namespace) {
  return new Promise((resolve, reject) => {
    let dta = '', err = '';
    let args = ['ls', '--kube-context', 'rancher-desktop', '-o', 'json'];
    if (namespace != undefined) {
      args.push('--namespace', namespace);
    }
    const bat = spawn('./resources/' + os.platform() + '/bin/helm', args);

    bat.stdout.on('data', (data) => {
      dta += data.toString();
    })

    bat.stderr.on('data', (data) => {
      err += data.toString();
    })

    bat.on('exit', (code) => {
      if (code === 0) {
        resolve(JSON.parse(dta));
      } else {
        reject('Failed to list resource: ' + err);
      }
    })
  })
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
      reject("name required to get status");
    }
    
    let dta = '', err = '';
    let args = ['status', name, '--kube-context', 'rancher-desktop', '-o', 'json'];
    if (namespace != undefined) {
      args.push('--namespace', namespace);
    }

    const bat = spawn('./resources/' + os.platform() + '/bin/helm', args);

    bat.stdout.on('data', (data) => {
      dta += data.toString();
    })

    bat.stderr.on('data', (data) => {
      err += data.toString();
    })

    bat.on('exit', (code) => {
      if (code === 0) {
        resolve(JSON.parse(dta));
      } else {
        reject('Failed to list resource: ' + err);
      }
    })
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
      reject("name required to install");
    }
    if (chart === undefined) {
      reject("chart required to install");
    }
    
    let dta = '', err = '';
    let args = ['install', name, chart, '--kube-context', 'rancher-desktop', '-o', 'json', '--wait'];
    if (namespace != undefined) {
      args.push('--namespace', namespace);
    }
    if (createNamespace) {
      args.push('--create-namespace');
    }

    // TODO: There is a lot of repeated code in this file. It could be simplified.
    const bat = spawn('./resources/' + os.platform() + '/bin/helm', args)

    bat.stdout.on('data', (data) => {
      dta += data.toString();
    })

    bat.stderr.on('data', (data) => {
      err += data.toString();
    })

    bat.on('exit', (code) => {
      if (code === 0) {
        resolve(JSON.parse(dta));
      } else {
        reject('Failed to list resource: ' + err);
      }
    });
  });
}

exports.list = list;
exports.status = status;
exports.install = install;
