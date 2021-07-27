declare module 'electron-proxy-agent' {
  import { Agent } from 'https';
  import Electron from 'electron';

  export default class ElectronProxyAgent extends Agent {
    constructor(session?: Electron.Session);

    /** Internally required by http/https client !? */
    protocol?: string;
  }
}
