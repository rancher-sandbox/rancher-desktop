'use strict';

const { BrowserWindow } = require('electron');


let url
if (process.env.NODE_ENV === 'DEV') {
  url = 'http://localhost:8080/';
} else {
  url = `file://${process.cwd()}/dist/index.html`;
}

let window;

function createWindow(cfg) {
  if (BrowserWindow.getAllWindows().length === 0) {
    window = new BrowserWindow({
      width: 940,
      height: 600,
      webPreferences: {
        nodeIntegration: true,
        nodeIntegrationInWorker: true
      }
    })
    window.loadURL(url);
    if (cfg.rd.devtools) {
      window.webContents.openDevTools();
    }
  } else {
    if (!window.isFocused()) {
      window.show();
    }
  }
}

exports.createWindow = createWindow;