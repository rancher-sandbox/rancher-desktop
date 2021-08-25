# nodejs app example

This sample demonstrates the deployment of a simple nodejs app (using Nest framework) to the kubernetes cluster within Rancher Desktop.

## Steps

Once Rancher Desktop is successfully installed and app started, Run below commands in a terminal.

```
kim build -t "nodejs-app:v1.0" .
kubectl run --image nodejs-app:v1.0 nodejsapp
kubectl get pods
kubectl port-forward pods/nodejsapp 9080:9080

```
Run below api end point in a browser or a tool like postman

```
http://localhost:9080/

```
