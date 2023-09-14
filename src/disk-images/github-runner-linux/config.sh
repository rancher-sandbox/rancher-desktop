#!/usr/bin/env bash

#======================================
# Include functions & variables
#--------------------------------------
test -f /.kconfig && . /.kconfig
test -f /.profile && . /.profile

suseSetupProduct

#======================================
# Import RPM keys
#--------------------------------------

# It's unclear why this is needed
rpmkeys --import /usr/lib/rpm/gnupg/keys/gpg-pubkey-*.asc

#======================================
# Runner Prepration
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
