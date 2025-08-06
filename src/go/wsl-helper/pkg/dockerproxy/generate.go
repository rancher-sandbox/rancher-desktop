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
	_ "github.com/go-swagger/go-swagger"
)

//go:generate -command swagger go tool swagger
//go:generate swagger generate server --quiet --skip-validation --config-file swagger-configuration.yaml --server-package models --spec swagger-modified.yaml

func init() {
}
