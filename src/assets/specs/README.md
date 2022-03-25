## Generators

### To generate go code:

oapi-codegen src/assets/specs/command-api.yaml > api/commands.go

#### Dependencies:

* opai-codegen: To install:

```bash
go get github.com/deepmap/oapi-codegen/cmd/oapi-codegen
```

### To generate documentation:

I looked at various tools. They either wanted me to sign up or didn't work:

* bump.sh - wants me to signup
* OpenDocumenter - vue.js-based, looks good, but installer is wonky, and it doesn't work when run from the github directory:

```bash
sh: vue-cli-service: command not found

 !!! Aborting due to error: Shell command exit with non zero code: 127
```

* Lucybot from https://github.com/LucyBot-Inc/documentation-starter - didn't load the current OpenAPI file.

What did work:

```
mkdir tmp
docker run --rm -v ${PWD}:/local openapitools/openapi-generator:online-latest-release generate -i /local/src/assets/specs/command-api.yaml -g html -o /local/tmp/
open tmp/index.html (MacOS)
```

## References:

* OpenAPI spec: https://github.com/OAI/OpenAPI-Specification/blob/main/versions/3.0.0.md#mediaTypeObject

* Tools: https://openapi.tools/
