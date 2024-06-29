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
	v1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/types"
	"k8s.io/client-go/informers"
	"k8s.io/client-go/kubernetes"
	"k8s.io/client-go/tools/cache"
)

// event occurs when a NodePort in a service is added or removed.
type event struct {
	UID         types.UID
	namespace   string
	name        string
	portMapping map[int32]corev1.Protocol
	deleted     bool
}

// watchServices monitors for NodePort and LoadBalancer services; after listing all service ports
// initially, it reports service ports being added or deleted.
func watchServices(ctx context.Context, client *kubernetes.Clientset) (<-chan event, <-chan error, error) {
	eventCh := make(chan event)
	errorCh := make(chan error)
	informerFactory := informers.NewSharedInformerFactory(client, 1*time.Hour)
	serviceInformer := informerFactory.Core().V1().Services()
	sharedInformer := serviceInformer.Informer()
	_, _ = sharedInformer.AddEventHandler(cache.ResourceEventHandlerFuncs{
		AddFunc: func(obj interface{}) {
			log.Debugf("Service Informer: Add func called with: %+v", obj)
			handleUpdate(nil, obj, eventCh)
		},
		DeleteFunc: func(obj interface{}) {
			log.Debugf("Service Informer: Del func called with: %+v", obj)
			handleUpdate(obj, nil, eventCh)
		},
		UpdateFunc: func(oldObj, newObj interface{}) {
			log.Debugf("Service Informer: Update func called with old object %+v and new Object: %+v", oldObj, newObj)
			handleUpdate(oldObj, newObj, eventCh)
		},
	})

	err := sharedInformer.SetWatchErrorHandler(func(_ *cache.Reflector, err error) {
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

	services, err := client.CoreV1().Services(corev1.NamespaceAll).List(ctx, v1.ListOptions{})
	if err != nil {
		return nil, nil, fmt.Errorf("error listing services: %w", err)
	}
	log.Debugf("coreV1 services list :%+v", services.Items)

	// List the initial set of services asynchronously, so that we don't have to
	// worry about the channel blocking.
	go func() {
		for _, svc := range services.Items {
			handleUpdate(nil, svc, eventCh)
		}
	}()

	return eventCh, errorCh, nil
}

// handleUpdate examines the old and new services, calculating the difference
// and emitting events to the given channel.
func handleUpdate(oldObj, newObj interface{}, eventCh chan<- event) {
	deleted := make(map[int32]corev1.Protocol)
	added := make(map[int32]corev1.Protocol)
	oldSvc, _ := oldObj.(*corev1.Service)
	newSvc, _ := newObj.(*corev1.Service)
	namespace := "<unknown>"
	name := "<unknown>"

	if oldSvc != nil {
		namespace = oldSvc.Namespace
		name = oldSvc.Name

		if oldSvc.Spec.Type == corev1.ServiceTypeNodePort {
			for _, port := range oldSvc.Spec.Ports {
				deleted[port.NodePort] = port.Protocol
			}
		}

		if oldSvc.Spec.Type == corev1.ServiceTypeLoadBalancer {
			for _, port := range oldSvc.Spec.Ports {
				deleted[port.Port] = port.Protocol
			}
		}
	}

	if newSvc != nil {
		namespace = newSvc.Namespace
		name = newSvc.Name

		if newSvc.Spec.Type == corev1.ServiceTypeNodePort {
			for _, port := range newSvc.Spec.Ports {
				delete(deleted, port.NodePort)
				added[port.NodePort] = port.Protocol
			}
		}

		if newSvc.Spec.Type == corev1.ServiceTypeLoadBalancer {
			for _, port := range newSvc.Spec.Ports {
				delete(deleted, port.Port)
				added[port.Port] = port.Protocol
			}
		}
	}

	if len(deleted) > 0 {
		sendEvents(deleted, oldSvc, true, eventCh)
	}

	if len(added) > 0 {
		sendEvents(added, newSvc, false, eventCh)
	}

	log.Debugf("kubernetes service update: %s/%s has -%d +%d service port",
		namespace, name, len(deleted), len(added))
}

func sendEvents(mapping map[int32]corev1.Protocol, svc *corev1.Service, deleted bool, eventCh chan<- event) {
	if svc != nil {
		eventCh <- event{
			UID:         svc.UID,
			namespace:   svc.Namespace,
			name:        svc.Name,
			portMapping: mapping,
			deleted:     deleted,
		}
	}
}
