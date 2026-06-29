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
	// Blank imports keeping modules that only generated code uses as direct
	// requirements. The swagger code under pkg/dockerproxy/models imports the
	// swag packages and is generated at build time, not checked in; go:generate
	// below runs the go-swagger tool. Without these, `go mod tidy` demotes the
	// modules to indirect when the generated code is absent — as it is in
	// dependabot's tree — breaking its update PRs.
	_ "github.com/go-openapi/runtime"
	_ "github.com/go-openapi/swag/conv"
	_ "github.com/go-openapi/swag/jsonutils"
	_ "github.com/go-openapi/swag/stringutils"
	_ "github.com/go-openapi/swag/typeutils"
	_ "github.com/go-swagger/go-swagger"
)

//go:generate -command swagger go tool swagger
//go:generate swagger generate server --quiet --skip-validation --config-file swagger-configuration.yaml --server-package models --spec swagger-modified.yaml

func init() {
}
