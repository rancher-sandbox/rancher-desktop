'use strict';

// This file contains the logic needed to start minikube. Minikube is the
// current engine used to power rd. This will likely change in the future as
// we work out the exact needs of the project and work to setup an underlying
// environment that works for it. For example, on Windows can we use WSL2?

var Minikube;

// TODO: Minikube handling should be completely overhaulded which includes a
// package, handling for non-mac, status detection, and more.
// TODO: Use MINIKUBE_HOME to set storing the config separately from the
// standard one. This should reside in the right spot on each system.
// TODO: Set it up so that an exit during startup does not cause issues.
// TODO: Prompt for password for elevated permissions on macos.

const paths = require('xdg-app-paths')({name: 'rancher-desktop'});
const process = require('process');
const { spawn } = require('child_process');
const os = require('os');

function start(exitfunc) {
    
    // Using a custom path so that the minikube default (if someone has it
    // installed) does not conflict with this app.
    let opts = {}
    opts.env = { ... process.env }
    opts.env['MINIKUBE_HOME'] = paths.data()

    // TODO: Handle platform differences
    const bat = spawn('./resources/' + os.platform() + '/minikube', ['start', '-p', 'rancher-desktop', '--driver', 'hyperkit', '--container-runtime', 'containerd', '--interactive=false'], opts);

    // TODO: For data toggle this based on a debug mode
    bat.stdout.on('data', (data) => {
        console.log(data.toString());
    });
    
    bat.stderr.on('data', (data) => {
        console.error(data.toString());
    });

    bat.on('exit', exitfunc);

    // Minikube puts the minikube information in a hidden directory. Use a
    // symlink on mac to make it visible to users searching their library.
    // if (os.platform() == 'darwin') {

    // }
}

function stop(exitfunc) {
    // Using a custom path so that the minikube default (if someone has it
    // installed) does not conflict with this app.
    let opts = {}
    opts.env = { ... process.env }
    opts.env['MINIKUBE_HOME'] = paths.data()

    // TODO: There MUST be a better way to exit. Do that.
    const bat = spawn('./resources/' + os.platform() + '/minikube', ['stop', '-p', 'rancher-desktop'], opts);

    // TODO: For data toggle this based on a debug mode
    bat.stdout.on('data', (data) => {
        console.log(data.toString());
    });

    bat.stderr.on('data', (data) => {
        console.error(data.toString());
    });

    bat.on('exit', exitfunc);
}

exports.start = start;
exports.stop = stop;