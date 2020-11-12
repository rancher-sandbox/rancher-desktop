const { https } = require('follow-redirects');
const fs = require('fs');
const { spawn } = require('child_process');

fs.mkdirSync("./resources/darwin", { recursive: true });

const file = fs.createWriteStream("./resources/darwin/minikube");
const request = https.get("https://github.com/kubernetes/minikube/releases/download/v1.14.0/minikube-darwin-amd64", function(response) {
  response.pipe(file);
});

// 

// TODO: handle failed download

// The download needs to be executable to run
const bat = spawn('chmod', ['+x', './resources/darwin/minikube']);

// Download Kubectl
const file2 = fs.createWriteStream("./resources/darwin/bin/kubectl");
const request2 = https.get("https://storage.googleapis.com/kubernetes-release/release/v1.19.3/bin/darwin/amd64/kubectl", function(response) {
  response.pipe(file2);
});
const bat2 = spawn('chmod', ['+x', './resources/darwin/bin/kubectl']);
