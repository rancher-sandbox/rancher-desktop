const { https } = require('follow-redirects');
const fs = require('fs');
const { spawn, spawnSync } = require('child_process');

fs.mkdirSync("./resources/darwin", { recursive: true });

const file = fs.createWriteStream("./resources/darwin/minikube");
https.get("https://github.com/kubernetes/minikube/releases/download/v1.14.0/minikube-darwin-amd64", function(response) {
  response.pipe(file);
  spawn('chmod', ['+x', './resources/darwin/minikube']);
});

// Download Kubectl
const file2 = fs.createWriteStream("./resources/darwin/bin/kubectl");
https.get("https://storage.googleapis.com/kubernetes-release/release/v1.19.3/bin/darwin/amd64/kubectl", function(response) {
  response.pipe(file2);

  spawn('chmod', ['+x', './resources/darwin/bin/kubectl']);
});

// Download Helm. It is a tar.gz file that needs to be expanded and file moved.
const file3 = fs.createWriteStream("/tmp/helm-v3.4.1-darwin-amd64.tar.gz");
https.get("https://get.helm.sh/helm-v3.4.1-darwin-amd64.tar.gz", function(response) {
  response.pipe(file3);

  spawn('tar', ['-zxvf', '/tmp/helm-v3.4.1-darwin-amd64.tar.gz', '--directory', "/tmp/"]).on('exit', (code, sig) => {
    spawn('mv', ['/tmp/darwin-amd64/helm', process.cwd() + '/resources/darwin/bin/helm']).on('exit', () => {
      spawnSync('rm', ['-rf', '/tmp/helm-v3.4.1-darwin-amd64.tar.gz', '/tmp/darwin-amd64']);
      spawnSync('chmod', ['+x', process.cwd() + '/resources/darwin/bin/helm']);
    }).stderr.on('data', (data) => {
      console.log(data.toString())
    })
  })
})
