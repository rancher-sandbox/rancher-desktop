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
package config

import (
	"os"

	"gopkg.in/yaml.v3"
)

type Tunnel struct {
	HandshakePort         uint32 `yaml:"handshake-port"`
	VsockHostPort         uint32 `yaml:"vsock-host-port"`
	PeerAddress           string `yaml:"peer-address"`
	PeerPort              int    `yaml:"peer-port"`
	UpstreamServerAddress string `yaml:"upstream-server-address"`
}
type Config struct {
	Tunnel []Tunnel `yaml:"tunnel"`
}

func NewConfig(path string) (*Config, error) {
	conf := &Config{}
	file, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer file.Close()

	d := yaml.NewDecoder(file)
	if err := d.Decode(&conf); err != nil {
		return nil, err
	}

	return conf, nil
}
