const { https } = require('follow-redirects');
const fs = require('fs');

const file = fs.createWriteStream("./resources/darwin/minikube");
const request = https.get("https://github.com/kubernetes/minikube/releases/download/v1.14.0/minikube-darwin-amd64", function(response) {
  response.pipe(file);
});

// TODO: chmod +x file
// TODO: handle failed download