// This downloads hyperkit, builds it, and puts the binary in the right place.

const fs = require('fs/promises');
const os = require('os');
const process = require('process');
const childProcess = require('child_process');
const path = require('path');

// The version of hyperkit to build
const ver = 'v0.20210107';

async function run() {
  // Using git and make to build the binary is intentional. There is no binary
  // download available from the project. Minikube checks the hyperkit version
  // so the correct version information needs to be included in the binary. Make
  // is used by the project to build a binary and it assumes the project was
  // retrieved via git and that git metadata for the version is available. The
  // Makefile uses git to retrieve the version and the sha (which is used for an
  // internal assertion).
  const destFile = path.resolve(process.cwd(), 'resources', os.platform(), 'hyperkit');
  const sourceDir = await fs.mkdtemp(path.join(os.tmpdir(), 'hyperkit-'));

  try {
    await fs.mkdir(path.resolve(process.cwd(), 'resources', os.platform()), { recursive: true });
    await spawn('git', 'clone', '--depth', '1', '--branch', ver, 'https://github.com/moby/hyperkit.git', sourceDir);
    await spawn('make', '-C', sourceDir);
    await fs.copyFile(path.resolve(sourceDir, 'build', 'hyperkit'), destFile );
    await fs.chmod(destFile, 0o755);
  } finally {
    try {
      await fs.rm(sourceDir, { recursive: true });
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

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
