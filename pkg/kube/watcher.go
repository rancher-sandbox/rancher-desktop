// Package kube watches Kubernetes for NodePort services and forces a listener
// on 127.0.0.1, so that it can be picked up by various automatic port
// forwarding mechanisms.
package kube

import (
	"context"
	"errors"
	"fmt"
	"io/fs"
	"net"
	"strconv"
	"syscall"
	"time"

	"github.com/Masterminds/log-go"
	"golang.org/x/sys/unix"
	corev1 "k8s.io/api/core/v1"
	"k8s.io/apimachinery/pkg/labels"
	"k8s.io/client-go/informers"
	"k8s.io/client-go/kubernetes"
	restclient "k8s.io/client-go/rest"
	"k8s.io/client-go/tools/cache"
	"k8s.io/client-go/tools/clientcmd"
)

// watcherState is an enumeration to track the state of the watcher.
type watcherState int

const (
	// stateNoConfig is before the configuration has been loaded
	stateNoConfig watcherState = iota
	// stateDisconnected is when the configuration has been loaded, but not connected.
	stateDisconnected
	stateConnected
	stateWatching
)

type event struct {
	// service being added or deleted
	service *corev1.Service
	// deleted is true if the service is being added; otherwise, it's being added.
	deleted bool
}

// WatchForNodePortServices watches Kubernetes for NodePort services and create
// listeners on 127.0.0.1 matching them.
//
// Any connection errors are ignored and retried.
//
// XXX bug(mook): on irrelevant change, this closes & reopens the port.
func WatchForNodePortServices(ctx context.Context, configPath string) error {
	state := stateNoConfig
	var err error
	var config *restclient.Config
	var clientset *kubernetes.Clientset
	var events <-chan event
	listeners := make(map[int32]net.Listener)
	for {
		switch state {
		case stateNoConfig:
			config, err = getClientConfig(configPath)
			if err != nil {
				if errors.Is(err, fs.ErrNotExist) {
					// Wait for the file to exist
					time.Sleep(time.Second)
					continue
				}
				return err
			}
			log.Debugf("loaded kubeconfig %s", configPath)
			state = stateDisconnected
		case stateDisconnected:
			clientset, err = kubernetes.NewForConfig(config)
			if err != nil {
				// There should be no transient errors here
				return fmt.Errorf("failed to create Kubernetes client: %w", err)
			}
			events, err = watchServices(ctx, clientset)
			if err != nil {
				var netError net.Error
				if errors.As(err, &netError) {
					if netError.Timeout() {
						// If it's a time out, the server may not be running yet
						time.Sleep(time.Second)
						continue
					}
				}
				return err
			}
			log.Debugf("watching kubernetes services")
			state = stateWatching
		case stateWatching:
			event := <-events
			if event.service.Spec.Type != corev1.ServiceTypeNodePort {
				// Ignore any non-NodePort errors
				log.Debugf("kubernetes service: not node port %s/%s", event.service.Namespace, event.service.Name)
				continue
			}
			if event.deleted {
				for _, port := range event.service.Spec.Ports {
					svc, ok := listeners[port.NodePort]
					if ok {
						if err := svc.Close(); err != nil {
							log.Errorw("failed to close listener", log.Fields{
								"error": err,
								"port":  port.NodePort,
							})
						}
						delete(listeners, port.NodePort)
						log.Debugf("kubernetes service: deleted %s/%s", event.service.Namespace, event.service.Name)
					}
				}
			} else {
				for _, port := range event.service.Spec.Ports {
					listener, err := (&net.ListenConfig{
						Control: func(network, address string, c syscall.RawConn) error {
							err := c.Control(func(fd uintptr) {
								// We should never get any traffic, and should
								// never wait on close; so set linger timeout to
								// 0.  This prevents normal socket close, but
								// that's okay as we don't handle any traffic.
								err := unix.SetsockoptLinger(int(fd), unix.SOL_SOCKET, unix.SO_LINGER, &unix.Linger{
									Onoff:  1,
									Linger: 0,
								})
								if err != nil {
									log.Errorw("failed to set SO_LINGER", log.Fields{
										"error": err,
										"port":  port.NodePort,
										"fd":    fd,
									})
								}
								err = unix.SetsockoptInt(int(fd), unix.SOL_SOCKET, unix.SO_REUSEADDR, 1)
								if err != nil {
									log.Errorw("failed to set SO_REUSEADDR", log.Fields{
										"error": err,
										"port":  port.NodePort,
										"fd":    fd,
									})
								}
								err = unix.SetsockoptInt(int(fd), unix.SOL_SOCKET, unix.SO_REUSEPORT, 1)
								if err != nil {
									log.Errorw("failed to set SO_REUSEPORT", log.Fields{
										"error": err,
										"port":  port.NodePort,
										"fd":    fd,
									})
								}
							})
							if err != nil {
								return err
							}
							return nil
						},
					}).Listen(ctx, "tcp4", net.JoinHostPort("127.0.0.1", strconv.Itoa(int(port.NodePort))))
					if err != nil {
						log.Errorw("failed to create listener", log.Fields{
							"error": err,
							"port":  port.NodePort,
						})
						continue
					}
					listeners[port.NodePort] = listener
					go func() {
						for {
							conn, err := listener.Accept()
							if err != nil {
								if !errors.Is(err, net.ErrClosed) {
									log.Errorw("failed to accept connection", log.Fields{
										"error": err,
										"port":  port.NodePort,
									})
								}
								return
							}
							// We don't handle any traffic; just unceremoniously
							// close the connection and let the other side deal.
							if err = conn.Close(); err != nil {
								log.Errorw("failed to close connection", log.Fields{
									"error": err,
									"port":  port.NodePort,
								})
							}
						}
					}()
					log.Debugw("kubernetes service: started listener", log.Fields{
						"namespace": event.service.Namespace,
						"name": event.service.Name,
						"port": port.NodePort,
					})
				}
			}
		}
	}
}

// getClientConfig returns a rest config.
func getClientConfig(configPath string) (*restclient.Config, error) {
	loadingRules := clientcmd.ClientConfigLoadingRules{
		ExplicitPath: configPath,
	}
	clientConfig := clientcmd.NewNonInteractiveDeferredLoadingClientConfig(&loadingRules, nil)
	config, err := clientConfig.ClientConfig()
	if err != nil {
		return nil, fmt.Errorf("could not load Kubernetes client config from %s: %w", configPath, err)
	}
	return config, nil
}

// watchServices monitors for services; after listing all services initially,
// it reports services being added or deleted.
func watchServices(ctx context.Context, client *kubernetes.Clientset) (<-chan event, error) {
	result := make(chan event)
	informerFactory := informers.NewSharedInformerFactory(client, 1*time.Hour)
	serviceInformer := informerFactory.Core().V1().Services()
	serviceInformer.Informer().AddEventHandler(cache.ResourceEventHandlerFuncs{
		AddFunc: func(obj interface{}) {
			if svc, ok := obj.(*corev1.Service); ok {
				log.Debugw("kubernetes service added", log.Fields{
					"namespace": svc.Namespace,
					"name": svc.Name,
					"ports": svc.Spec.Ports,
				})
				result <- event{service: svc}
			}
		},
		DeleteFunc: func(obj interface{}) {
			if svc, ok := obj.(*corev1.Service); ok {
				log.Debugw("kubernetes service deleted", log.Fields{
					"namespace": svc.Namespace,
					"name": svc.Name,
					"ports": svc.Spec.Ports,
				})
				result <- event{service: svc, deleted: true}
			}
		},
		UpdateFunc: func(oldObj, newObj interface{}) {
			// Treat updates as delete + add.
			// TODO: ignore the even if the NodePort didn't change (otherwise we
			// would get issues around TIME_WAIT)
			if svc, ok := oldObj.(*corev1.Service); ok {
				log.Debugw("kubernetes service modified: old", log.Fields{
					"namespace": svc.Namespace,
					"name": svc.Name,
					"ports": svc.Spec.Ports,
				})
				result <- event{service: svc, deleted: true}
			}
			if svc, ok := newObj.(*corev1.Service); ok {
				log.Debugw("kubernetes service modified: new", log.Fields{
					"namespace": svc.Namespace,
					"name": svc.Name,
					"ports": svc.Spec.Ports,
				})
				result <- event{service: svc}
			}
		},
	})
	informerFactory.WaitForCacheSync(ctx.Done())
	informerFactory.Start(ctx.Done())
	services, err := serviceInformer.Lister().List(labels.Everything())
	if err != nil {
		return nil, fmt.Errorf("error listing services: %w", err)
	}
	// List the initial set of services asynchronously, so that we don't have to
	// worry about the channel blocking.
	go func() {
		for _, svc := range services {
			log.Debugw("kubernetes service: initial", log.Fields{
				"namespace": svc.Namespace,
				"name": svc.Name,
				"ports": svc.Spec.Ports,
		})
			result <- event{service: svc}
		}
	}()
	return result, nil
}
