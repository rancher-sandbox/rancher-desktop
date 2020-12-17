'use strict';

const { BrowserWindow } = require('electron');


let url
if (process.env.NODE_ENV === 'DEV') {
  url = 'http://localhost:8080/';
} else {
  url = 'app:///renderer/index.html';
}

let window;

function createWindow() {
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
  } else {
    if (!window.isFocused()) {
      window.show();
    }
  }
}

exports.createWindow = createWindow;