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

sudo kiwi ${DEBUG:+--debug} system build \
    --description "${PWD}" \
    --target-dir "${WORKDIR}"

cp "${WORKDIR}"/github-runner-linux.x86_64-*.qcow2 "./${1:-}"
