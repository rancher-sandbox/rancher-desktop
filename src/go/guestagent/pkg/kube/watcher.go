// Package kube watches Kubernetes for NodePort services and forces a listener
// on 127.0.0.1, so that it can be picked up by various automatic port
// forwarding mechanisms.
package kube

import (
	"context"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"net"
	"time"

	"github.com/Masterminds/log-go"
	"github.com/rancher-sandbox/rancher-desktop-agent/pkg/tcplistener"
	"golang.org/x/sys/unix"
	corev1 "k8s.io/api/core/v1"
	apierrors "k8s.io/apimachinery/pkg/api/errors"
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

// eventType describes the type of event
type eventType int

const (
	eventAdded eventType = iota
	eventDeleted
	// eventError indicates an error that causes us to reload
	eventError
)

type event struct {
	// eventType is the type of event
	eventType eventType
	// service being added or deleted; only for eventAdded and eventDeleted
	service *corev1.Service
	// error for eventError events
	err error
}

// WatchForNodePortServices watches Kubernetes for NodePort services and create
// listeners on 127.0.0.1 matching them.
//
// Any connection errors are ignored and retried.
//
// XXX bug(mook): on irrelevant change, this closes & reopens the port.
func WatchForNodePortServices(ctx context.Context, tracker *tcplistener.ListenerTracker, configPath string) error {
	state := stateNoConfig
	var err error
	var config *restclient.Config
	var clientset *kubernetes.Clientset
	var events <-chan event
	watchContext, watchCancel := context.WithCancel(ctx)
	localhost := net.IPv4(127, 0, 0, 1)
	// Always cancel if we failed; however, we may clobber watchCancel, so we
	// need a wrapper function to capture the variable reference.
	defer func() {
		watchCancel()
	}()
	for {
		switch state {
		case stateNoConfig:
			config, err = getClientConfig(configPath)
			if err != nil {
				log.Debugw("kubernetes: failed to read kubeconfig", log.Fields{
					"config-path": configPath,
					"error": err,
				})
				if errors.Is(err, fs.ErrNotExist) {
					// Wait for the file to exist
					time.Sleep(time.Second)
					continue
				}
				return err
			}
			log.Debugf("kubernetes: loaded kubeconfig %s", configPath)
			state = stateDisconnected
		case stateDisconnected:
			clientset, err = kubernetes.NewForConfig(config)
			if err != nil {
				// There should be no transient errors here
				log.Errorw("failed to load kubeconfig", log.Fields{
					"config-path": configPath,
					"error": err,
				})
				return fmt.Errorf("failed to create Kubernetes client: %w", err)
			}
			events, err = watchServices(watchContext, clientset)
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
			if event.eventType == eventError {
				log.Debugw("kubernetes: got error, rolling back", log.Fields{
					"error": event.err,
				})
				clientset = nil
				watchCancel()
				watchContext, watchCancel = context.WithCancel(ctx)
				state = stateNoConfig
				time.Sleep(time.Second)
				continue
			}
			if event.service.Spec.Type != corev1.ServiceTypeNodePort {
				// Ignore any non-NodePort errors
				log.Debugf("kubernetes service: not node port %s/%s", event.service.Namespace, event.service.Name)
				continue
			}
			if event.eventType == eventDeleted {
				for _, port := range event.service.Spec.Ports {
					if err := tracker.Remove(localhost, int(port.NodePort)); err != nil {
						log.Errorw("failed to close listener", log.Fields{
							"error": err,
							"port": port.NodePort,
							"namespace": event.service.Namespace,
							"name": event.service.Name,
						})
						continue
					}
					log.Debugw("kuberentes service: deleted listener", log.Fields{
						"namespace": event.service.Namespace,
						"name": event.service.Name,
						"port": port.NodePort,
					})
				}
			} else {
				for _, port := range event.service.Spec.Ports {
					if err := tracker.Add(localhost, int(port.NodePort)); err != nil {
						log.Errorw("failed to create listener", log.Fields{
							"error": err,
							"port":  port.NodePort,
							"namespace": event.service.Namespace,
							"name": event.service.Name,
						})
						continue
					}
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
	sharedInformer := serviceInformer.Informer()
	sharedInformer.AddEventHandler(cache.ResourceEventHandlerFuncs{
		AddFunc: func(obj interface{}) {
			if svc, ok := obj.(*corev1.Service); ok {
				log.Debugw("kubernetes service added", log.Fields{
					"namespace": svc.Namespace,
					"name": svc.Name,
					"ports": svc.Spec.Ports,
				})
				result <- event{eventType: eventAdded, service: svc}
			}
		},
		DeleteFunc: func(obj interface{}) {
			if svc, ok := obj.(*corev1.Service); ok {
				log.Debugw("kubernetes service deleted", log.Fields{
					"namespace": svc.Namespace,
					"name": svc.Name,
					"ports": svc.Spec.Ports,
				})
				result <- event{eventType: eventDeleted, service: svc}
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
				result <- event{eventType: eventDeleted, service: svc}
			}
			if svc, ok := newObj.(*corev1.Service); ok {
				log.Debugw("kubernetes service modified: new", log.Fields{
					"namespace": svc.Namespace,
					"name": svc.Name,
					"ports": svc.Spec.Ports,
				})
				result <- event{eventType: eventAdded, service: svc}
			}
		},
	})
	sharedInformer.SetWatchErrorHandler(func(r *cache.Reflector, err error) {
		log.Debugw("kubernetes: error watching", log.Fields{
			"error": err,
		})
		var timeoutError interface{
			Timeout() bool
		}
		if !errors.As(err, &timeoutError) {
			timeoutError = nil
		}
		switch {
		case apierrors.IsResourceExpired(err):
			// resource expired; the informer will adapt, ignore.
		case apierrors.IsGone(err):
			// resource is gone; the informer will adapt, ignore.
		case apierrors.IsServiceUnavailable(err):
			// service unavailable; it should come back later.
		case errors.Is(err, io.EOF):
			// watch closed normally; ignore.
		case errors.Is(err, io.ErrUnexpectedEOF):
			// connection interrupted; informer will retry, ignore.
		case timeoutError != nil && timeoutError.Timeout():
			// connection is a time out of some sort, this is fine
		case errors.Is(err, unix.ECONNREFUSED):
			// connection refused; the server is down.
			// Note that "failed to list" errors need k8s.io/client-go 0.25.0
			result <- event{eventType: eventError, err: err}
		default:
			var statusError *apierrors.StatusError
			if errors.As(err, &statusError) {
				log.Debugw("kubernetes: got status error", log.Fields{
					"status": statusError.Status(),
					"debug": fmt.Sprintf(statusError.DebugError()),
				})
			}
			log.Errorw("kubernetes: unexpected error watching", log.Fields{
				"error": err,
			})
		}
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
