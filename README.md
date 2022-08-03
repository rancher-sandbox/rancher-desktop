# Rancher Desktop Agent

The Rancher Desktop guest agent runs in Rancher Desktop VMs providing helper
services.  It currently has the following functionality:

## containerd port forwarding (WSL)

In Windows Subsystem for Linux, WSL automatically forwards ports opened on
`127.0.0.1` or `0.0.0.0` by opening the corresponding port on `127.0.0.1` on the
host (running Windows).  However, `containerd` (as configured by `nerdctl`) just
sets up `iptables` rules rather than actually listening, meaning this isn't
caught by the normal mechanisms.  Rancher Desktop Agent therefore creates the
listeners so that they get picked up and forwarded automatically.  Note that the
listeners will never receive any traffic, as the `iptables` rules are in place
to forward the traffic before it reaches the application.  This is not necessary
for Lima, as that already does the `iptables` scanning (the core of the code has
been lifted from Lima).

## Kubernetes NodePort forwarding

In newer versions of Kubernetes†, `kubelet` no longer creates a listener for
NodePort services.  We therefore need to create those listeners manually, so
that port forward works correctly as in the container port forwarding above.

† 1.21.12+, 1.22.10+, 1.23.7+, 1.24+
