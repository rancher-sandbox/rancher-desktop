load '../helpers/load'

local_setup() {
    if using_docker; then
        skip "this test only works on containerd right now"
    fi
}

assert_traefik_crd_established() {
    local jsonpath="{.status.conditions[?(@.type=='Established')].status}"
    run kubectl get crd traefikservices.traefik.containo.us --output jsonpath="$jsonpath"
    assert_success || return
    assert_output 'True'
}

@test 'start k8s' {
    factory_reset
    start_kubernetes
    wait_for_kubelet

    # The manifests in /var/lib/rancher/k3s/server/manifests are processed
    # in alphabetical order. So when traefik.yaml has been loaded we know that
    # rd-runtime.yaml has already been processed.
    try assert_traefik_crd_established
}

@test 'deploy sample app' {
    kubectl apply --filename - <<EOF
apiVersion v1
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
        image: nginx
        volumeMounts:
        - name: webapp-config-volume
          mountPath: /usr/share/nginx/html
EOF
}

get_host() {
    if is_windows; then
        local LB_IP
        local output='jsonpath={.status.loadBalancer.ingress[0].ip}'
        LB_IP=$(kubectl get service traefik --namespace kube-system --output "$output")
        echo "$LB_IP.sslip.io"
    else
        echo "localhost"
    fi
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
  - host: $(get_host)
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

@test 'connect to the service' {
    # This can take 100s with old versions of traefik, and 15s with newer ones.
    run try curl --silent --fail "http://$(get_host)"
    assert_success
    assert_output "Hello World!"
}

@test 'fail to connect to the service on localhost without port forwarding' {
    run try curl --silent --fail "http://localhost:8080"
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
    run try curl --silent --fail "http://localhost:8080"
    assert_failure
}
