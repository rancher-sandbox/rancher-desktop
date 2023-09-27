#!/usr/bin/env bash

# Copyright © 2023 SUSE LLC
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.

set -o errexit -o nounset

cleanup() {
    if [[ -n "${WORKDIR:-}" && -d "${WORKDIR}" ]]; then
        sudo rm -rf "${WORKDIR}"
    fi
}
trap cleanup EXIT

WORKDIR="$(mktemp --tmpdir --directory kiwi.github-runner-linux.XXXXXX)"
IMAGE_NAME="${1:-}"

if [[ "${#@}" -gt 0 ]]; then
    shift
fi

global_options=()
local_options=()

while [[ "${#@}" -gt 0 ]]; do
    case "$1" in
    --color-output) global_options+=("$1");;
    --config=*) global_options+=("$1");;
    --config) global_options+=("$1" "$2"); shift;;
    --logfile=*) global_options+=("$1");;
    --logfile) global_options+=("$1" "$2"); shift;;
    --debug) global_options+=("$1");;
    --debug-run-scripts-in-screen) global_options+=("$1");;
    --version|-v) global_options+=("$1");;
    --profile=*) global_options+=("$1");;
    --profile) global_options+=("$1" "$2"); shift;;
    --shared-cache-dir=*) global_options+=("$1");;
    --shared-cache-dir) global_options+=("$1" "$2"); shift;;
    --temp-dir=*) global_options+=("$1");;
    --temp-dir) global_options+=("$1" "$2"); shift;;
    *) local_options+=("$1");;
    esac
    shift
done

sudo kiwi "${global_options[@]}" system build \
    --description "${PWD}" \
    --target-dir "${WORKDIR}" \
    "${local_options[@]}"

shopt -s nullglob # One of the two below will be missing
cp "${WORKDIR}"/github-runner-linux.x86_64-*.qcow2 \
   "${WORKDIR}"/github-runner-linux.x86_64-*.vhdx \
   "${IMAGE_NAME:-./}"
