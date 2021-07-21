import path from 'path';
import { Application } from 'spectron';
import { SpectronClient } from 'spectron';
import { BrowserWindow } from 'electron';
const electronPath = require('electron');

let app:Application;
let client: SpectronClient;
let browserWindow: BrowserWindow;

jest.setTimeout(1_000_000);

beforeAll(async function() {
  app = new Application({
    path: electronPath as any,
    args:             [path.join(__dirname, '..')],
    webdriverOptions: {},
    env:              { NODE_ENV: 'test' }
  });

  await app.start();
  client = app.client;
  browserWindow = app.browserWindow;
});

afterAll(async function() {
  if (app && app.isRunning()) {
    await app.stop();
  }
});

it('opens the window', async() => {
  await client.waitUntilWindowLoaded();
  const title = await browserWindow.getTitle();

  expect(title).toBe('Rancher Desktop');
});

it('should display welcome message in general tab !', async() => {
  await client.waitUntilWindowLoaded(60_000);
  const text = await (await client.$('.general h1')).getText();

  expect(text).toEqual('Welcome to Rancher Desktop');
});

/* it('should switch to kubernetes tab !', async() => {
  await browserWindow.loadURL('http://localhost:8888/pages/K8s');
  await client.waitUntilWindowLoaded(60_000);
  const text = await (await client.$('.general h1')).getText();

  expect(text).toEqual('Welcome to Rancher Desktop');
}); */
