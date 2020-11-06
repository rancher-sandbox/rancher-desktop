'use strict';

const { BrowserWindow } = require('electron')


let url
if (process.env.NODE_ENV === 'DEV') {
  url = 'http://localhost:8080/'
} else {
  url = `file://${process.cwd()}/dist/index.html`
}

function createWindow() {
    let window = new BrowserWindow({width: 800, height: 600})
    window.loadURL(url)
}

exports.createWindow = createWindow;