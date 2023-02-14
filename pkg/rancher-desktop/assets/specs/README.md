## Generators

### To generate go code:

`oapi-codegen pkg/rancher-desktop/assets/specs/command-api.yaml > api/commands.go`

#### Dependencies:

* opai-codegen: To install:

```bash
go get github.com/deepmap/oapi-codegen/cmd/oapi-codegen
```

### To generate documentation:

```
mkdir tmp
docker run --rm -v ${PWD}:/local openapitools/openapi-generator-cli:v5.4.2 generate -i /local/src/assets/specs/command-api.yaml -g html -o /local/tmp/
open tmp/index.html # (MacOS)
start tmp/index.html # (Powershell)
xdg-open tmp/index.html # (linux, replace with path to a specific browser if you prefer).
```

Recommended tag: openapitools/openapi-generator-cli:v5.4.2

So run:
```
docker run ... openapitools/openapi-generator-cli@sha256:3d7c84e4b8f25a2074d6ab44d936cd69d08a223021197269e75d29992204e15e
```

## References:

* OpenAPI spec: https://github.com/OAI/OpenAPI-Specification/blob/main/versions/3.0.0.md#mediaTypeObject

* Tools: https://openapi.tools/
