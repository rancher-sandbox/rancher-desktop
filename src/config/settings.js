'use strict';

// This file contains the code to work with the settings.json file along with
// code docs on it.

const paths = require('xdg-app-paths')({name: 'rancher-desktop'});
const fs = require('fs');

// Load the settings file
function load() {

    // read the settings file into memory
    const rawdata = fs.readFileSync(paths.config() + '/settings.json');
    let settings = JSON.parse(rawdata);

    // TODO: validate it

    return settings

}

const defaultSettings = {
    kubernetes: {
        version: "v1.19.2"
    }
}

function save(cfg) {
    fs.mkdirSync(paths.config(), { recursive: true });
    let rawdata = JSON.stringify(cfg)
    fs.writeFile(paths.config() + '/settings.json', rawdata, (err) => {
        if (err) {
            const { dialog } = require('electron')
            dialog.showErrorBox("Unable To Save Settings File", err.toString())
        } else {
            console.log("Settings file saved\n"); 
        }
    })
}

// Load the settings file or create it if not present.
function init() {
    let settings = {}
    try {
        settings = load()
    } catch (err) {
        // Create default settings
        settings = defaultSettings

        // TODO: save settings file
        save(settings)
    }

    return settings
}

exports.init = init;