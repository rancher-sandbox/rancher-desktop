load '../helpers/load'

@test 'start k8s' {
    factory_reset
    start_kubernetes
    wait_for_kubelet
}

@test 'deploy sample app' {
    kubectl apply --filename - <<EOF
apiVersion: v1
kind: ConfigMap
metadata:
  name: webapp-configmap
data:
  index: "Hello World!"
---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: webapp
spec:
  replicas: 1
  selector:
    matchLabels:
      app: webapp
  template:
    metadata:
      labels:
        app: webapp
    spec:
      volumes:
      - name: webapp-config-volume
        configMap:
          name: webapp-configmap
          items:
          - key: index
            path: index.html
      containers:
      - name: webapp
        image: $IMAGE_NGINX
        volumeMounts:
        - name: webapp-config-volume
          mountPath: /usr/share/nginx/html
EOF
}

@test 'deploy ingress' {
    kubectl apply --filename - <<EOF
apiVersion: v1
kind: Service
metadata:
  name: webapp
spec:
  type: ClusterIP
  selector:
    app: webapp
  ports:
  - port: 80
---
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: webapp
  annotations:
    traefik.ingress.kubernetes.io/router.entrypoints: web
spec:
  rules:
  - host: localhost
    http:
      paths:
        - path: /
          pathType: Prefix
          backend:
            service:
              name: webapp
              port:
                number: 80
EOF
}

@test 'fail to connect to the service on localhost without port forwarding' {
    run try --max 5 curl --silent --fail "http://localhost:8080"
    assert_failure
}

@test 'connect to the service on localhost with port forwarding' {
    rdctl api -X POST -b '{ "namespace": "default", "service": "webapp", "k8sPort": 80, "hostPort": 8080 }' port_forwarding
    run try curl --silent --fail "http://localhost:8080"
    assert_success
    assert_output "Hello World!"
}

@test 'fail to connect to the service on localhost after removing port forwarding' {
    rdctl api -X DELETE "port_forwarding?namespace=default&service=webapp&k8sPort=80"
    run try --max 5 curl --silent --fail "http://localhost:8080"
    assert_failure
}
