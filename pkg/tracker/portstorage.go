/*
Copyright © 2023 SUSE LLC
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

package tracker

import (
	"sync"

	"github.com/Masterminds/log-go"
	"github.com/docker/go-connections/nat"
)

// portStorage is responsible for storing all the port mappings.
type portStorage struct {
	// container ID is the key for both docker and containerd
	portmap map[string]nat.PortMap
	mutex   sync.Mutex
}

func newPortStorage() *portStorage {
	return &portStorage{
		portmap: make(map[string]nat.PortMap),
	}
}

func (p *portStorage) add(containerID string, portMap nat.PortMap) {
	p.mutex.Lock()
	p.portmap[containerID] = portMap
	p.mutex.Unlock()
	log.Debugf("portStorage add status: %+v", p.portmap)
}

func (p *portStorage) get(containerID string) nat.PortMap {
	p.mutex.Lock()
	defer p.mutex.Unlock()

	log.Debugf("portStorage get status: %+v", p.portmap)

	if portMap, ok := p.portmap[containerID]; ok {
		return portMap
	}

	return nil
}

func (p *portStorage) removeAll() {
	p.mutex.Lock()
	defer p.mutex.Unlock()

	for containerID, portMap := range p.portmap {
		log.Debugf("removing the following container [%s] port binding: %+v", containerID, portMap)
		delete(p.portmap, containerID)
	}
}

func (p *portStorage) getAll() map[string]nat.PortMap {
	p.mutex.Lock()
	defer p.mutex.Unlock()

	portMappings := make(map[string]nat.PortMap, len(p.portmap))

	for k, v := range p.portmap {
		portMappings[k] = copyPortMap(v)
	}

	return portMappings
}

func copyPortMap(m nat.PortMap) nat.PortMap {
	portMap := make(nat.PortMap, len(m))

	for k, v := range m {
		portMap[k] = v
	}

	return portMap
}

func (p *portStorage) remove(containerID string) {
	p.mutex.Lock()
	defer p.mutex.Unlock()
	delete(p.portmap, containerID)
	log.Debugf("portStorage remove status: %+v", p.portmap)
}
