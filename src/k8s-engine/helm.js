'use strict';

const { spawn } = require('child_process');
const os = require('os');

/*
 * List returns the current Helm releases in a namespace. If no namespace is
 * provided the current default is used. It is recommended that you
 */
async function list(namespace) {
  return new Promise((resolve, reject) => {
    let dta, err
    let args = ['ls', '--kube-context', 'rancher-desktop', '-o', 'json']
    if (namespace != undefined) {
      args.push('-n')
      args.push(namespace)
    }
    const bat = spawn('./resources/' + os.platform() + '/bin/helm', args)

    bat.stdout.on('data', (data) => {
      dta = data.toString()
    })

    bat.stderr.on('data', (data) => {
      err = data.toString()
    })

    bat.on('exit', (code) => {
      console.log('code ' + code)
      if (code === 0) {
        resolve(dta)
      } else {
        reject('Failed to list resource: ' + err)
      }
    })
  })
}

async function status(name, namespace) {
  return new Promise((resolve, reject) => {
    if (name === undefined) {
      reject("name required to get status")
    }
    
    let dta, err
    let args = ['status', name, '--kube-context', 'rancher-desktop', '-o', 'json']
    if (namespace != undefined) {
      args.push('-n')
      args.push(namespace)
    }

    const bat = spawn('./resources/' + os.platform() + '/bin/helm', args)

    bat.stdout.on('data', (data) => {
      dta = data.toString()
    })

    bat.stderr.on('data', (data) => {
      err = data.toString()
    })

    bat.on('exit', (code) => {
      console.log('code ' + code)
      if (code === 0) {
        resolve(dta)
      } else {
        reject('Failed to list resource: ' + err)
      }
    })
  });
}

async function install(name, chart, namespace) {
  return new Promise((resolve, reject) => {
    if (name === undefined) {
      reject("name required to install")
    }
    if (chart === undefined) {
      reject("chart required to install")
    }
    
    let dta, err
    let args = ['install', name, chart, '--kube-context', 'rancher-desktop', '-o', 'json', '--wait']
    if (namespace != undefined) {
      args.push('-n')
      args.push(namespace)
    }

    // TODO: There is a lot of repeated code in this file. It could be simplified.
    const bat = spawn('./resources/' + os.platform() + '/bin/helm', args)

    bat.stdout.on('data', (data) => {
      dta = data.toString()
    })

    bat.stderr.on('data', (data) => {
      err = data.toString()
    })

    bat.on('exit', (code) => {
      console.log('code ' + code)
      if (code === 0) {
        resolve(dta)
      } else {
        reject('Failed to list resource: ' + err)
      }
    })
  });
}

exports.list = list;
exports.status = status;
exports.install = install;