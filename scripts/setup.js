const { https } = require('follow-redirects');
const fs = require('fs');
const os = require("os");
const { spawn, spawnSync } = require('child_process');
const current_os = os.type().toLowerCase()
const binPath = "./resources/bin"

console.log("Setting up files for " + current_os)

let minikubeUrl = "https://github.com/kubernetes/minikube/releases/download/v1.14.0/minikube-" + current_os + "-amd64";
let kubectlUrl = "https://storage.googleapis.com/kubernetes-release/release/v1.19.3/bin/" + current_os + "/amd64/kubectl";
let helmUrl = "https://get.helm.sh/helm-v3.4.1-" + current_os + "-amd64.tar.gz";

fs.mkdirSync(binPath, { recursive: true });

const file = fs.createWriteStream(binPath + "/minikube");
https.get(minikubeUrl, function(response) {
  response.on('data', (data) => {
    file.write(data);
  });

  response.on('end', () => {
    file.end();
    spawn('chmod', ['+x', binPath + '/minikube']);
  });
});

// Download Kubectl
const file2 = fs.createWriteStream(binPath + "/kubectl");
https.get(kubectlUrl, function(response) {
  response.on('data', (data) => {
    file2.write(data);
  });

  response.on('end', () => {
    file2.end();
    spawn('chmod', ['+x', binPath + '/kubectl']);
  });
});

// Download Helm. It is a tar.gz file that needs to be expanded and file moved.
const file3 = fs.createWriteStream("/tmp/helm-v3.4.1-amd64.tar.gz");
https.get(helmUrl, function(response) {
  response.on('data', (data) => {
    file3.write(data);
  })
  response.on('end', () => {
    file3.end();
    spawn('tar', ['-zxvf', '/tmp/helm-v3.4.1-amd64.tar.gz', '--directory', "/tmp/"]).on('exit', (code, sig) => {
      spawn('mv', ['/tmp/' + current_os + '-amd64/helm', binPath + '/helm']).on('exit', () => {
        spawnSync('rm', ['-rf', '/tmp/helm-v3.4.1-amd64.tar.gz', '/tmp/' + current_os + '-amd64']);
        spawnSync('chmod', ['+x', binPath + '/helm']);
      }).stderr.on('data', (data) => {
        console.log(data.toString());
      })
    })
  })
})
