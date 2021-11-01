//go:build windows
// +build windows

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

package dockerproxy

import (
	"fmt"
	"sync"

	"github.com/linuxkit/virtsock/pkg/hvsock"
	"golang.org/x/sys/windows/registry"
)

// Racer is a helper structure to return either a successful result (the GUID of
// the Hyper-V virtual machine for WSL2), or an error if all attempts have
// failed.
type racer struct {
	result    hvsock.GUID
	lastError error
	count     int
	lock      sync.Locker
	cond      *sync.Cond
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
	return hvsock.GUIDZero, r.lastError
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
	r.lastError = err
	r.count -= 1
	r.cond.Signal()
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
				fmt.Printf("skipping invalid VM name %s\n", name)
				r.reject(fmt.Errorf("invalid VM name %w", err))
				return
			}
			conn, err := dialHvsock(guid, port)
			if err != nil {
				err := fmt.Errorf("could not dial VM %s: %w", name, err)
				fmt.Printf("%s\n", err)
				r.reject(err)
				return
			}
			defer conn.Close()

			fmt.Printf("Got WSL2 VM %s\n", guid.String())
			r.resolve(guid)
		}(name)
	}

	result, err := r.wait()
	if err != nil {
		return hvsock.GUIDZero, fmt.Errorf("could not find WSL2 VM ID: %w", err)
	}
	return result, nil
}
