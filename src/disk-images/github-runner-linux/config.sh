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

#======================================
# Include functions & variables
#--------------------------------------
test -f /.kconfig && . /.kconfig # spellcheck-ignore-line
test -f /.profile && . /.profile

suseSetupProduct

#======================================
# Import RPM keys
#--------------------------------------

# It's unclear why this is needed
rpmkeys --import /usr/lib/rpm/gnupg/keys/gpg-pubkey-*.asc # spellcheck-ignore-line

#======================================
# Runner Preparation
#--------------------------------------
chown runner:runner /runner

url="https://api.github.com/repos/actions/runner/releases/latest"
info="$(curl -s "${url}")"
version="$(jq -r .tag_name <<< "${info}")"

curl -o /tmp/actions-runner.tgz -L "https://github.com/actions/runner/releases/download/${version}/actions-runner-linux-x64-${version#v}.tar.gz"
sudo -u runner tar xzf /tmp/actions-runner.tgz -C /runner
rm /tmp/actions-runner.tgz

chmod a+x /usr/local/bin/start-runner
systemctl enable github-runner.service

#======================================
# Rancher Desktop Prerequisites
#--------------------------------------
npm install --global yarn
