// This downloads hyperkit, builds it, and puts the binary in the right place.

const fs = require('fs');
const os = require('os');
const { spawn, spawnSync } = require('child_process');

fs.mkdirSync("./resources/" + os.platform(), { recursive: true });

// The version of hyperkit to build
let ver = "v0.20210107";

// TODO: rewrite to remove callbackitis
spawn('git', ['clone', '--depth', '1', '--branch', ver, "https://github.com/moby/hyperkit.git"], { cwd: '/tmp/' }).on('exit', () => {
  spawn('make', [], { cwd: '/tmp/hyperkit/' }).on('exit', () => {
    fs.copyFile('/tmp/hyperkit/build/hyperkit', process.cwd() + '/resources/' + os.platform() + '/hyperkit', (err) => {
      if (err != null) {
        console.log(err);
        return;
      }
      try {
        fs.rm('/tmp/hyperkit', { recursive: true }, (err) => {
          if (err != null) {
            console.log(err);
          }
        });
      } catch (err) {
        console.log(err);
      }
      spawnSync('chmod', ['+x', process.cwd() + '/resources/' + os.platform() + '/hyperkit']);
    })
  })
})
