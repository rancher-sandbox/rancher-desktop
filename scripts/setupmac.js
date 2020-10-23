const { https } = require('follow-redirects');
const fs = require('fs');
const { spawn } = require('child_process');

fs.mkdirSync("./resources/darwin", { recursive: true });

const file = fs.createWriteStream("./resources/darwin/minikube");
const request = https.get("https://github.com/kubernetes/minikube/releases/download/v1.14.0/minikube-darwin-amd64", function(response) {
  response.pipe(file);
});

// TODO: handle failed download

// The download needs to be executable to run
const bat = spawn('chmod', ['+x', './resources/darwin/minikube']);
