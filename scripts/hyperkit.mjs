// This downloads hyperkit, builds it, and puts the binary in the right place.

import fs from 'fs';
import os from 'os';
import process from 'process';
import childProcess from 'child_process';
import path from 'path';
import util from 'util';

// The version of hyperkit to build
const ver = 'v0.20210107';

// Command lines for sudo.  Note that this will be passed to `sh -c`.
const sudoTasks = [];

/**
 * Build the Hyperkit binary.
 * @param destPath {string} The output path for the binary.
 * @returns {string} The executable in the work directory.
 */
async function buildHyperkit(destPath) {
  try {
    await fs.promises.access(destPath, fs.constants.X_OK);

    const { gid } = await fs.promises.stat(destPath);

    if (gid !== 80) {
      console.log('hyperkit is owned by wrong group, rebuilding...');
    } else {
      console.log('hyperkit is acceptable, not building.');

      return;
    }
  } catch (e) {
    if (e.code !== 'ENOENT') {
      console.error(e);
    }
    console.log('hyperkit not available, building...');
  }
  // Using git and make to build the binary is intentional. There is no binary
  // download available from the project. Minikube checks the hyperkit version
  // so the correct version information needs to be included in the binary. Make
  // is used by the project to build a binary and it assumes the project was
  // retrieved via git and that git metadata for the version is available. The
  // Makefile uses git to retrieve the version and the sha (which is used for an
  // internal assertion).
  const workPath = await fs.promises.mkdtemp(destPath.replace(/(?:\.exe)?$/, '-'));

  try {
    await spawn('git', 'clone', '--depth', '1', '--branch', ver, 'https://github.com/moby/hyperkit.git', workPath);
    await spawn('make', '-C', workPath);
    const outPath = path.resolve(workPath, 'build', 'hyperkit');

    await fs.promises.chmod(outPath, 0o755);
    await fs.promises.rename(outPath, destPath);
    sudoTasks.push(`chown :admin ${ destPath }`);

    return outPath;
  } finally {
    await fs.promises.rm(workPath, { recursive: true });
  }
}

/**
 * Build the docker-machine driver binary.
 * @param destPath {string} The output path for the driver.
 * @returns {Promise<void>}
 */
async function buildDockerMachineDriver(destPath) {
  const project = 'docker-machine-driver-hyperkit';
  const version = 'v2.0.0-alpha.5';
  const url = `https://github.com/rancher-sandbox/${ project }/releases/download/${ version }/${ project }`;

  await fs.promises.mkdir(path.dirname(destPath), { recursive: true });
  try {
    await fs.promises.access(destPath, fs.constants.X_OK);
    const { stdout } = await util.promisify(childProcess.execFile)(destPath, ['--version']);

    if (!stdout.trimEnd().endsWith(version)) {
      console.log(`Found ${ stdout.trim() } - updating to ${ version }`);
    } else {
      const { uid, mode } = await fs.promises.stat(destPath);

      if (uid !== 0 || (mode & 0o4000) === 0) {
        console.log(`${ project } has incorrect permissions`);
      } else {
        return;
      }
    }
  } catch (e) {
    if (e.code !== 'ENOENT') {
      console.error(e);
    }
    console.log(`${ project } not available, downloading...`);
  }

  const workDir = await fs.promises.mkdtemp(destPath.replace(/(?:\.exe)?$/, '-'));
  const tempPath = path.join(workDir, path.basename(destPath));

  try {
    await spawn('curl', '-Lo', tempPath, url);
    sudoTasks.push(`chown root:wheel '${ destPath }'`);
    sudoTasks.push(`chmod u+s,a+x '${ destPath }'`);
    await fs.promises.rename(tempPath, destPath);
  } finally {
    try {
      await fs.promises.rm(workDir, { recursive: true });
    } catch (err) {
      console.error(err);
      // Allow the failure here.
    }
  }
}

function getScriptFn(url) {
  return async function(workPath) {
    const outPath = path.join(workPath, 'script');

    await spawn('curl', '-Lo', outPath, url);
    await fs.promises.chmod(outPath, 0o755);

    return outPath;
  };
}

/**
 * Check if a file exists, and if not, build it.
 * @param destPath {string} The output executable.
 * @param fn {(workDir: string) => Promise<string>} A function to build it, returning the built artifact.
 * @param mode {number} File mode required.
 */
async function buildIfNotAccess(destPath, fn, mode = fs.constants.X_OK) {
  try {
    await fs.promises.access(destPath, fs.constants.X_OK);

    return;
  } catch (ex) {
    // The output must be rebuilt.
  }
  const tmpDirPrefix = destPath.replace(/(?:\.exe)$/, '-');
  const workDir = await fs.promises.mkdtemp(tmpDirPrefix);

  try {
    const outPath = await fn(workDir);

    await fs.promises.mkdir(path.dirname(destPath), { recursive: true });
    await fs.promises.rename(outPath, destPath);
  } finally {
    try {
      await fs.promises.rm(workDir, { recursive: true });
    } catch (err) {
      console.error(err);
      // Allow the failure here.
    }
  }
}

/**
 * Spawn a command, with all output going to the controlling terminal; raise an
 * exception if it returns a non-zero exit code.
 */
async function spawn(command, ...args) {
  const options = { stdio: 'inherit' };

  if (args.concat().pop() instanceof Object) {
    Object.assign(options, args.pop());
  }
  const child = childProcess.spawn(command, args, options);

  return await new Promise((resolve, reject) => {
    child.on('exit', (code, signal) => {
      if (signal && signal !== 'SIGTERM') {
        reject(new Error(`${ command } exited with signal ${ signal }`));
      } else if (code > 0) {
        reject(new Error(`${ command } exited with code ${ code }`));
      } else {
        resolve();
      }
    });
    child.on('error', reject);
  });
}

export default async function run() {
  // This is _not_ parallel, so that we can read the outputs easier (especially
  // since building the docker machine driver requires sudo).
  await buildHyperkit(path.resolve(process.cwd(), 'resources', os.platform(), 'hyperkit'));
  await buildDockerMachineDriver(
    path.resolve(process.cwd(), 'resources', os.platform(), 'docker-machine-driver-hyperkit'));
  await buildIfNotAccess(
    path.resolve(process.cwd(), 'resources', os.platform(), 'run-k3s'),
    getScriptFn('https://github.com/jandubois/tinyk3s/raw/v0.1/run-k3s'));
  await buildIfNotAccess(
    path.resolve(process.cwd(), 'resources', os.platform(), 'kubeconfig'),
    getScriptFn('https://github.com/jandubois/tinyk3s/raw/v0.1/kubeconfig'));
  if (sudoTasks.length > 0) {
    console.log('Will run the following commands under sudo:');
    for (const task of sudoTasks) {
      console.log(`+ ${ task }`);
    }
    await spawn('sudo', '--prompt=Enter sudo password:',
      '/bin/sh', '-xc', sudoTasks.join(' && '));
  }
}
