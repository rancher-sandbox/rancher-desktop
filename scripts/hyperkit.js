// This downloads hyperkit, builds it, and puts the binary in the right place.

const fs = require('fs');
const os = require('os');
const { spawn } = require('child_process');

fs.mkdirSync("./resources/" + os.platform(), { recursive: true });

// The version of hyperkit to build
let ver = "v0.20210107";

// Using git and make to build the binary is intentional. There is no binary
// download available from the project. Minikube checks the hyperkit version
// so the correct version information needs to be included in the binary. Make
// is used by the project to build a binary and it assumes the project was
// retrieved via git and that git metadata for the version is available. The
// Makefile uses git to retrieve the version and the sha (which is used for an
// internal assertion).
spawn('git', ['clone', '--depth', '1', '--branch', ver, "https://github.com/moby/hyperkit.git"], { cwd: '/tmp/' }).on('exit', (code) => {
  if (code != null && code != 0) {
    console.error(`git exited in error with code: ${code}`);
    return;
  }
  spawn('make', [], { cwd: '/tmp/hyperkit/' }).on('exit', (code) => {
    if (code != null && code != 0) {
      console.error(`make exited in error with code: ${code}`);
      return;
    }
    fs.copyFile('/tmp/hyperkit/build/hyperkit', process.cwd() + '/resources/' + os.platform() + '/hyperkit', (err) => {
      if (err != null) {
        console.error(err);
        return;
      }
      try {
        fs.rm('/tmp/hyperkit', { recursive: true }, (err) => {
          if (err != null) {
            console.error(err);
          }
        });
      } catch (err) {
        console.error(err);
      }
      fs.chmod(process.cwd() + '/resources/' + os.platform() + '/hyperkit', 0o755, (err) => {
        if (err != null) {
          console.error(err)
        }
      });
    })
  })
})
