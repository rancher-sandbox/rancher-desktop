'use strict';

import childProcess, { spawn } from 'child_process';
import process from 'process';

import resources from '@/utils/resources';

// The K8s JS library will get the current context but does not have the ability
// to save the context. The current version of the package targets k8s 1.18 and
// there are new config file features (e.g., proxy) that may be lost by outputting
// the config with the library. So, we drop down to kubectl for this.
export function setCurrentContext(cxt: string, exitfunc: (code: number | null, signal: NodeJS.Signals | null) => void) {
  const opts: childProcess.SpawnOptions = {};

  opts.env = { ...process.env };

  const bat = spawn(resources.executable('kubectl'), ['config', 'use-context', cxt], opts);

  // TODO: For data toggle this based on a debug mode
  bat.stdout?.on('data', (data) => {
    console.log(data.toString());
  });

  bat.stderr?.on('data', (data) => {
    console.error(data.toString());
  });

  bat.on('exit', exitfunc);
}
