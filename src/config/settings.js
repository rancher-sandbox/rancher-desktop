'use strict';

// This file contains the code to work with the settings.json file along with
// code docs on it.

const paths = require('xdg-app-paths')({name: 'rancher-desktop'});
const fs = require('fs');
const deepmerge = require('deepmerge');

// Load the settings file
function load() {

    // read the settings file into memory
    const rawdata = fs.readFileSync(paths.config() + '/settings.json');
    let settings = JSON.parse(rawdata);
    let cfg = deepmerge(defaultSettings, settings)

    // TODO: validate it

    return cfg

}

const defaultSettings = {
    kubernetes: {
        version: "v1.19.2"
    }
}

function save(cfg, inBrowser) {
    fs.mkdirSync(paths.config(), { recursive: true });
    let rawdata = JSON.stringify(cfg)
    try {
        fs.writeFileSync(paths.config() + '/settings.json', rawdata)
    } catch (err) {
        if (err) {
            if (inBrowser) {
                alert("Unable To Save Settings File: " + err.toString())
            } else {
                const { dialog } = require('electron')
                dialog.showErrorBox("Unable To Save Settings File", err.toString())
            }
        } else {
            console.log("Settings file saved\n"); 
        }
    }
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
exports.load = load;
exports.save = save;