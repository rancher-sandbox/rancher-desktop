const fs = require('fs');
const { spawn, spawnSync } = require('child_process');
const { https } = require('follow-redirects');

fs.mkdirSync('./resources/darwin/bin', { recursive: true });

const file = fs.createWriteStream('./resources/darwin/minikube');
https.get('https://github.com/jandubois/minikube/releases/download/k3s0/minikube-darwin-amd64', function(response) {
  response.on('data', (data) => {
    file.write(data);
  });

  response.on('end', () => {
    file.end();
    spawn('chmod', ['+x', './resources/darwin/minikube']);
  });
});

// Download Kubectl
const file2 = fs.createWriteStream('./resources/darwin/bin/kubectl');
https.get('https://storage.googleapis.com/kubernetes-release/release/v1.19.3/bin/darwin/amd64/kubectl', function(response) {
  response.on('data', (data) => {
    file2.write(data);
  });

  response.on('end', () => {
    file2.end();
    spawn('chmod', ['+x', './resources/darwin/bin/kubectl']);
  });
});

// Download Helm. It is a tar.gz file that needs to be expanded and file moved.
const file3 = fs.createWriteStream('/tmp/helm-v3.4.1-darwin-amd64.tar.gz');
https.get('https://get.helm.sh/helm-v3.4.1-darwin-amd64.tar.gz', function(response) {
  response.on('data', (data) => {
    file3.write(data);
  });
  response.on('end', () => {
    file3.end();
    spawn('tar', ['-zxvf', '/tmp/helm-v3.4.1-darwin-amd64.tar.gz', '--directory', '/tmp/']).on('exit', () => {
      spawn('cp', ['-f', '/tmp/darwin-amd64/helm', process.cwd() + '/resources/darwin/bin/helm']).on('exit', () => {
        spawnSync('rm', ['-rf', '/tmp/helm-v3.4.1-darwin-amd64.tar.gz', '/tmp/darwin-amd64']);
        spawnSync('chmod', ['+x', process.cwd() + '/resources/darwin/bin/helm']);
      }).stderr.on('data', (data) => {
        console.log(data.toString());
      });
    });
  });
});
