'use strict';

// This file contains the logic needed to start minikube. Minikube is the
// current engine used to power rd. This will likely change in the future as
// we work out the exact needs of the project and work to setup an underlying
// environment that works for it. For example, on Windows can we use WSL2?

// TODO: Minikube handling should be completely overhaulded which includes a
// package, handling for non-mac, status detection, and more.
// TODO: Set it up so that an exit during startup does not cause issues.
// TODO: Prompt for password for elevated permissions on macos.

const paths = require('xdg-app-paths')({name: 'rancher-desktop'});
const process = require('process');
const { spawn } = require('child_process');
const os = require('os');
const { dialog } = require('electron')
const fs = require('fs')

async function start(cfg, nested) {
    return new Promise((resolve, reject) => {
        // We want to block being caught in an infinite loop. This is used for
        // that situation.
        if (nested === undefined) {
            nested = false
        }

        let permsMsg = false

        // Using a custom path so that the minikube default (if someone has it
        // installed) does not conflict with this app.
        let opts = {}
        opts.env = { ... process.env }
        opts.env['MINIKUBE_HOME'] = paths.data()

        // TODO: Handle platform differences
        let args = ['start', '-p', 'rancher-desktop', '--driver', 'hyperkit', '--container-runtime', 'containerd', '--interactive=false']
        
        // TODO: Handle the difference between changing version where a wipe is needed
        // and upgrading. All if there was a change.
        args.push("--kubernetes-version=" + cfg.version)
        const bat = spawn('./resources/' + os.platform() + '/minikube', args, opts);

        // TODO: For data toggle this based on a debug mode
        bat.stdout.on('data', (data) => {
            const subst = "The 'hyperkit' driver requires elevated permissions."
            let str = data.toString()
            if (str.indexOf(subst) > -1) {
                permsMsg = true
            }

            console.log(data.toString());
        });
        
        bat.stderr.on('data', (data) => {
            console.error(data.toString());
        });

        bat.on('exit', async function(code) {

            // When nested we do not want to keep going down the rabbit hole on error
            if (code == 80 && permsMsg && !nested) {
                // TODO: perms modal
                // TODO: Handle non-macos cases. This can be changed when multiple
                // hypervisors are used.
                let resp = await startAgain(cfg).catch((err) => { reject(err) })
                resolve(resp)
                return
            }

            // Run the callback function.
            if (code == 0) {
                resolve(code)
            } else {
                dialog.showErrorBox("Error Starting Kuberentes", "Kubernetes was unable to start with the following exit code: " + code)
                reject(code)
            }
        });

        // Minikube puts the minikube information in a hidden directory. Use a
        // symlink on mac to make it visible to users searching their library.
        if (os.platform() == 'darwin') {
            if (!fs.existsSync(paths.data() + '/minikube') && fs.existsSync(paths.data() + '/.minikube'))
            fs.symlinkSync(paths.data() + '/.minikube', paths.data() + '/minikube')
        }
    })
}

async function stop() {
    return new Promise((resolve, reject) => {
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

        bat.on('exit', (code) => {
            if (code === 0) {
                resolve(code)
            } else {
                reject(code)
            }
        });
    })
}

async function del() {
    return new Promise((resolve, reject) => {
        let opts = {}
        opts.env = { ... process.env }
        opts.env['MINIKUBE_HOME'] = paths.data()

        // TODO: There MUST be a better way to exit. Do that.
        const bat = spawn('./resources/' + os.platform() + '/minikube', ['delete', '-p', 'rancher-desktop'], opts);

        // TODO: For data toggle this based on a debug mode
        bat.stdout.on('data', (data) => {
            console.log(data.toString());
        });

        bat.stderr.on('data', (data) => {
            console.error(data.toString());
        });

        bat.on('exit', (code) => {
            if (code === 0) {
                resolve(code)
            } else {
                reject(code)
            }
        });
    })
}

exports.start = start;
exports.stop = stop;
exports.del = del;

// This will try to start again, this time after handling permissions
async function startAgain(cfg) {
    return new Promise((resolve, reject) => {
        const sudo = require('sudo-prompt');
        const options = {
            name: 'Rancher Desktop',
        };
        sudo.exec(`sh -c 'chown root:wheel "${paths.data()}/.minikube/bin/docker-machine-driver-hyperkit"; chmod u+s "${paths.data()}/.minikube/bin/docker-machine-driver-hyperkit"'`, options,
            async function(error, stdout, stderr) {
                if (error) throw error;
                
                let resp = await start(cfg, true).catch((err) => { reject(err) })
                resolve(resp)
            }
        );
    })
}