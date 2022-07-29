package kube

import (
	"context"
	"errors"
	"fmt"
	"io"
	"time"

	"github.com/Masterminds/log-go"
	"golang.org/x/sys/unix"
	corev1 "k8s.io/api/core/v1"
	apierrors "k8s.io/apimachinery/pkg/api/errors"
	"k8s.io/apimachinery/pkg/labels"
	"k8s.io/client-go/informers"
	"k8s.io/client-go/kubernetes"
	"k8s.io/client-go/tools/cache"
)

// event occurs when a NodePort in a service is added or removed.
type event struct {
	service *corev1.Service
	deleted bool
}

// watchServices monitors for services; after listing all services initially,
// it reports services being added or deleted.
func watchServices(ctx context.Context, client *kubernetes.Clientset) (<-chan event, <-chan error, error) {
	eventCh := make(chan event)
	errorCh := make(chan error)
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
				eventCh <- event{ service: svc}
			}
		},
		DeleteFunc: func(obj interface{}) {
			if svc, ok := obj.(*corev1.Service); ok {
				log.Debugw("kubernetes service deleted", log.Fields{
					"namespace": svc.Namespace,
					"name": svc.Name,
					"ports": svc.Spec.Ports,
				})
				eventCh <- event{service: svc, deleted: true}
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
				eventCh <- event{service: svc, deleted: true}
			}
			if svc, ok := newObj.(*corev1.Service); ok {
				log.Debugw("kubernetes service modified: new", log.Fields{
					"namespace": svc.Namespace,
					"name": svc.Name,
					"ports": svc.Spec.Ports,
				})
				eventCh <- event{service: svc}
			}
		},
	})
	sharedInformer.SetWatchErrorHandler(func(r *cache.Reflector, err error) {
		log.Debugw("kubernetes: error watching", log.Fields{
			"error": err,
		})
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
		case isTimeout(err):
			// connection is a time out of some sort, this is fine
		case errors.Is(err, unix.ECONNREFUSED):
			// connection refused; the server is down.
			// Note that "failed to list" errors need k8s.io/client-go 0.25.0
			errorCh <- err
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
		return nil, nil, fmt.Errorf("error listing services: %w", err)
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
			eventCh <- event{service: svc}
		}
	}()
	return eventCh, errorCh, nil
}
