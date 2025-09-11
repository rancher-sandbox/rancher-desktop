#!/usr/bin/env bash

set -o errexit -o nounset -o pipefail

# There is a single module with 0BSD license which is actually BSD-2-clause on GitHub
ALLOWED="Apache-2.0|0?BSD|ISC|MIT|Python-2.0|Unlicense"

# jq doesn't support \b word boundaries, so expand "\b(${ALLOWED})\b" into something supported
REGEX="(^|[^a-zA-Z0-9_])(${ALLOWED})($|[^a-zA-Z0-9_])"

JQ="select(.value | test(\"${REGEX}\") | not)"
FORBIDDEN=$(yarn licenses list --production --json | jq -r "$JQ")

if [[ -z $FORBIDDEN ]]; then
    echo "All NPM modules have licenses matching ${ALLOWED}"
    exit 0
fi

echo "Forbidden license(s) detected; allowed are ${ALLOWED}"
echo "$FORBIDDEN"
exit 1
