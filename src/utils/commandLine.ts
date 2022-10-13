import Electron from 'electron';

// When running the packaged app, if the app is launched as
// PATH-TO-RD-APP ELECTRON-OPTIONS -- RD-OPTIONS
// then process.argv shows up as
// [ PATH-TO-RD-APP, ...RD-OPTIONS]
// On macOS, the command-line would be `PATH-TO-RD-APP ELECTRON-OPTIONS --args RD-OPTIONS`
//
// When running `npm run dev ELECTRON-OPTIONS -- ARGS
// then process.argv shows up as
// [ .../node_modules/PATH-TO-ELECTRON-BINARY, SOURCE-ROOT,  RENDERER-PORT,
//   PATH-TO-NODE-JS, ../scripts/dev.ts, ...ARGS]
//
// When running `npm run test:e2e...`, process.argv is:
// [PATH-TO-ELECTRON-BINARY, --inspect=0, --remote-debugging-port=0, SOURCE-ROOT,
//  --disable-gpu, --whitelisted-ips=, --disable-dev-shm-usage ]

// Note that there is an `Electron.app.commandLine` object, but it's used for configuring
// the internal Chromium instance.

export default function getCommandLineArgs(): string[] {
  if (Electron.app.isPackaged) {
    return process.argv.slice(1);
  } else if ((process.env.NODE_ENV ?? '').startsWith('dev')) {
    // Are we running in dev mode?
    const idx = process.argv.findIndex(arg => /[\\\/]dev.ts$/.test(arg));

    return idx >= 0 ? process.argv.slice(idx + 1) : [];
  } else if ((process.env.npm_lifecycle_event ?? '').startsWith('test:e2e')) {
    // Note there are comments in the e2e tests near this arg warning any modifications need to take
    // this line into consideration.
    const idx = process.argv.indexOf('--disable-dev-shm-usage');

    return idx > -1 ? process.argv.slice(idx + 1) : [];
  }
  console.log(`Couldn't figure out how we're being run: ENV[NODE_ENV] = ${ process.env.NODE_ENV }, ENV[npm_lifecycle_event] = ${ process.env.npm_lifecycle_event ?? 'unset' }`);

  return [];
}
