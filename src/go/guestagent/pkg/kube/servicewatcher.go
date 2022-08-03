/*
Copyright © 2022 SUSE LLC
Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at
    http://www.apache.org/licenses/LICENSE-2.0
Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
*/

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
	namespace string
	name      string
	port      int32
	deleted   bool
}

// watchServices monitors for NodePort services; after listing all service ports
// initially, it reports service ports being added or deleted.
func watchServices(ctx context.Context, client *kubernetes.Clientset) (<-chan event, <-chan error, error) {
	eventCh := make(chan event)
	errorCh := make(chan error)
	informerFactory := informers.NewSharedInformerFactory(client, 1*time.Hour)
	serviceInformer := informerFactory.Core().V1().Services()
	sharedInformer := serviceInformer.Informer()
	sharedInformer.AddEventHandler(cache.ResourceEventHandlerFuncs{
		AddFunc: func(obj interface{}) {
			handleUpdate(nil, obj, eventCh)
		},
		DeleteFunc: func(obj interface{}) {
			handleUpdate(obj, nil, eventCh)
		},
		UpdateFunc: func(oldObj, newObj interface{}) {
			handleUpdate(oldObj, newObj, eventCh)
		},
	})

	err := sharedInformer.SetWatchErrorHandler(func(r *cache.Reflector, err error) {
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
					"debug":  fmt.Sprintf(statusError.DebugError()),
				})
			}
			log.Errorw("kubernetes: unexpected error watching", log.Fields{
				"error": err,
			})
		}
	})
	if err != nil {
		return nil, nil, fmt.Errorf("error watching services: %w", err)
	}

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
			handleUpdate(nil, svc, eventCh)
		}
	}()

	return eventCh, errorCh, nil
}

// handleUpdate examines the old and new services, calculating the difference
// and emitting events to the given channel.
func handleUpdate(oldObj, newObj interface{}, eventCh chan<- event) {
	deleted := make(map[int32]struct{})
	added := make(map[int32]struct{})
	oldSvc, _ := oldObj.(*corev1.Service)
	newSvc, _ := newObj.(*corev1.Service)
	namespace := "<unknown>"
	name := "<unknown>"

	if oldSvc != nil {
		namespace = oldSvc.Namespace
		name = oldSvc.Name

		if oldSvc.Spec.Type == corev1.ServiceTypeNodePort {
			for _, port := range oldSvc.Spec.Ports {
				deleted[port.NodePort] = struct{}{}
			}
		}
	}

	if newSvc != nil {
		namespace = newSvc.Namespace
		name = newSvc.Name

		if newSvc.Spec.Type == corev1.ServiceTypeNodePort {
			for _, port := range newSvc.Spec.Ports {
				if _, ok := deleted[port.NodePort]; ok {
					// This port is in both added & deleted; skip it.
					delete(deleted, port.NodePort)
				} else {
					added[port.NodePort] = struct{}{}
				}
			}
		}
	}

	log.Debugf("kubernetes service update: %s/%s has -%d +%d NodePorts",
		namespace, name, len(deleted), len(added))

	sendEvents := func(mapping map[int32]struct{}, svc *corev1.Service, deleted bool) {
		for port := range mapping {
			eventCh <- event{
				namespace: svc.Namespace,
				name:      svc.Name,
				port:      port,
				deleted:   deleted,
			}
		}
	}

	sendEvents(deleted, oldSvc, true)
	sendEvents(added, newSvc, false)
}
