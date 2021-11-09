package dockerproxy

import (
	_ "github.com/go-swagger/go-swagger"
)

//go:generate -command swagger go run github.com/go-swagger/go-swagger/cmd/swagger@v0.28.0
//go:generate swagger generate server --skip-validation --config-file swagger-configuration.yaml --server-package models --spec swagger.yaml

func init() {
}
