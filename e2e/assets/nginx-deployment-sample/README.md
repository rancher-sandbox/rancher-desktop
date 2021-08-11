# nginx deployment sample

This sample demonstrates the deployment of nginx server to the kubernetes cluster within Rancher Desktop.

## Steps

Once Rancher Desktop is successfully installed and app started, Run below commands in a terminal.

```
kubectl create namespace rd-nginx-demo
kubectl apply -f assets\nginx-deployment-sample\nginx-app.yaml -n rd-nginx-demo
kubectl get pods -n rd-nginx-demo
kubectl port-forward pods/<pod-id> 8080:80 -n rd-nginx-demo

```
Open localhost:8080 in browser to view nginx server landing page.
