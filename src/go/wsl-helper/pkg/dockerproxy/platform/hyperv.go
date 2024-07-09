//go:build windows

/*
Copyright © 2021 SUSE LLC

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

package platform

import (
	"fmt"
	"strings"
	"sync"

	"github.com/linuxkit/virtsock/pkg/hvsock"
	"github.com/sirupsen/logrus"
	"golang.org/x/sys/windows/registry"
)

// Racer is a helper structure to return either a successful result (the GUID of
// the Hyper-V virtual machine for WSL2), or an error if all attempts have
// failed.
type racer struct {
	result hvsock.GUID
	errors []error
	count  int
	lock   sync.Locker
	cond   *sync.Cond
}

// newRacer constructs a new racer that will return an error after the given
// number of calls to reject().
func newRacer(n int) *racer {
	mutex := &sync.Mutex{}
	return &racer{
		result: hvsock.GUIDZero,
		count:  n,
		lock:   mutex,
		cond:   sync.NewCond(mutex),
	}
}

// Wait for a result; either the parameter of any resolve() call, or the last
// error from a reject() call.
func (r *racer) wait() (hvsock.GUID, error) {
	r.lock.Lock()
	defer r.lock.Unlock()
	for r.count > 0 {
		r.cond.Wait()
	}
	if r.result != hvsock.GUIDZero {
		return r.result, nil
	}
	return hvsock.GUIDZero, r
}

// Resolve the racer with the given successful result.
func (r *racer) resolve(guid hvsock.GUID) {
	r.lock.Lock()
	defer r.lock.Unlock()
	if r.result == hvsock.GUIDZero {
		r.result = guid
	}
	r.count = 0
	r.cond.Signal()
}

// Reject the racer with the given unsuccessful result.
func (r *racer) reject(err error) {
	r.lock.Lock()
	defer r.lock.Unlock()
	r.errors = append(r.errors, err)
	r.count -= 1
	r.cond.Signal()
}

func (r racer) Error() string {
	r.lock.Lock()
	defer r.lock.Unlock()
	if len(r.errors) == 0 {
		return "<no error>"
	}
	if len(r.errors) == 1 {
		return r.errors[0].Error()
	}
	messages := make([]string, 0, len(r.errors))
	for _, err := range r.errors {
		messages = append(messages, err.Error())
	}
	return fmt.Sprintf("multiple errors: \n\t- %s", strings.Join(messages, "\n\t- "))
}

func (r racer) Unwrap() error {
	r.lock.Lock()
	defer r.lock.Unlock()
	if len(r.errors) == 1 {
		return r.errors[0]
	}
	return nil
}

// Probe the system to detect the correct VM GUID for the WSL virtual machine.
// This requires that WSL2 is already running.
func probeVMGUID(port uint32) (hvsock.GUID, error) {
	key, err := registry.OpenKey(
		registry.LOCAL_MACHINE,
		`SOFTWARE\Microsoft\Windows NT\CurrentVersion\HostComputeService\VolatileStore\ComputeSystem`,
		registry.ENUMERATE_SUB_KEYS)
	if err != nil {
		return hvsock.GUIDZero, fmt.Errorf("could not open registry key: %w", err)
	}
	names, err := key.ReadSubKeyNames(0)
	if err != nil {
		return hvsock.GUIDZero, fmt.Errorf("could not list virtual machine IDs: %w", err)
	}

	r := newRacer(len(names))
	for _, name := range names {
		go func(name string) {
			guid, err := hvsock.GUIDFromString(name)
			if err != nil {
				r.reject(fmt.Errorf("invalid VM name %w", err))
				return
			}
			conn, err := dialHvsock(guid, port)
			if err != nil {
				err := fmt.Errorf("could not dial VM %s: %w", name, err)
				r.reject(err)
				return
			}
			defer conn.Close()

			logrus.WithField("guid", guid.String()).Info("Got WSL2 VM")
			r.resolve(guid)
		}(name)
	}

	result, err := r.wait()
	if err != nil {
		return hvsock.GUIDZero, fmt.Errorf("could not find WSL2 VM ID: %w", err)
	}
	return result, nil
}
