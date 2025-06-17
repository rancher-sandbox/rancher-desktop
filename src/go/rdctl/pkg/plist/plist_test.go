package plist

import (
	"testing"

	"github.com/stretchr/testify/assert"
)

func TestJsonToPlistFormat(t *testing.T) {
	t.Run("handles empty bodies", func(t *testing.T) {
		s, err := JSONToPlist("{}")
		assert.NoError(t, err)
		assert.Equal(t, `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
  <dict>
    <key>version</key>
    <integer>16</integer>
  </dict>
</plist>
`, s)
	})

	t.Run("Handles arrays", func(t *testing.T) {
		jsonBody := `{"application": { "extensions": { "allowed": {
        "enabled": false,
        "list": ["wink", "blink", "drink"]
     } } }, "containerEngine": { "name": "beatrice" }}`
		s, err := JSONToPlist(jsonBody)
		assert.NoError(t, err)
		assert.Equal(t, `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
  <dict>
    <key>version</key>
    <integer>16</integer>
    <key>application</key>
    <dict>
      <key>extensions</key>
      <dict>
        <key>allowed</key>
        <dict>
          <key>enabled</key>
          <false/>
          <key>list</key>
          <array>
            <string>wink</string>
            <string>blink</string>
            <string>drink</string>
          </array>
        </dict>
      </dict>
    </dict>
    <key>containerEngine</key>
    <dict>
      <key>name</key>
      <string>beatrice</string>
    </dict>
  </dict>
</plist>
`, s)
	})

	t.Run("Handles everything", func(t *testing.T) {
		jsonBody := `{
  "version": 9,
  "application": {
    "adminAccess": false,
    "debug": false,
    "extensions": {
      "allowed": {
        "enabled": false,
        "list": [
          "<wi & nk>",
          "blink",
          "ok"
        ]
      },
      "installed": {}
    },
    "pathManagementStrategy": "rcfiles",
    "telemetry": {
      "enabled": true
    },
    "updater": {
      "enabled": true
    },
    "autoStart": false,
    "startInBackground": false,
    "hideNotificationIcon": false,
    "window": {
      "quitOnClose": false
    }
  },
  "containerEngine": {
    "allowedImages": {
      "enabled": false,
      "patterns": []
    },
    "name": "moby"
  },
  "virtualMachine": {
    "memoryInGB": 4,
    "mount": {
      "type": "reverse-sshfs"
    },
    "numberCPUs": 2,
    "type": "qemu",
    "useRosetta": false
  },
  "WSL": {
    "integrations": {
      "first": true,
      "second": false,
      "third": true
    }
  },
  "kubernetes": {
    "version": "1.27.3",
    "port": 6443,
    "enabled": true,
    "options": {
      "traefik": true,
      "flannel": true
    },
    "ingress": {
      "localhostOnly": false
    }
  },
  "portForwarding": {
    "includeKubernetesServices": false
  },
  "images": {
    "showAll": true,
    "namespace": "k8s.io"
  },
  "diagnostics": {
    "showMuted": false,
    "mutedChecks": {
      "moss": true,
      "dial": false
    }
  },
  "experimental": {
    "virtualMachine": {
      "mount": {
        "9p": {
          "securityModel": "none",
          "protocolVersion": "9p2000.L",
          "msizeInKib": 128,
          "cacheMode": "mmap"
        }
      },
      "proxy": {
        "enabled": false,
        "address": "",
        "password": "",
        "port": 3128,
        "username": ""
      }
    }
  }
}
`
		s, err := JSONToPlist(jsonBody)
		assert.NoError(t, err)
		assert.Equal(t, `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
  <dict>
    <key>version</key>
    <integer>9</integer>
    <key>application</key>
    <dict>
      <key>adminAccess</key>
      <false/>
      <key>debug</key>
      <false/>
      <key>extensions</key>
      <dict>
        <key>allowed</key>
        <dict>
          <key>enabled</key>
          <false/>
          <key>list</key>
          <array>
            <string>&lt;wi &amp; nk&gt;</string>
            <string>blink</string>
            <string>ok</string>
          </array>
        </dict>
        <key>installed</key>
        <dict>
        </dict>
      </dict>
      <key>pathManagementStrategy</key>
      <string>rcfiles</string>
      <key>telemetry</key>
      <dict>
        <key>enabled</key>
        <true/>
      </dict>
      <key>updater</key>
      <dict>
        <key>enabled</key>
        <true/>
      </dict>
      <key>autoStart</key>
      <false/>
      <key>startInBackground</key>
      <false/>
      <key>hideNotificationIcon</key>
      <false/>
      <key>window</key>
      <dict>
        <key>quitOnClose</key>
        <false/>
      </dict>
    </dict>
    <key>containerEngine</key>
    <dict>
      <key>name</key>
      <string>moby</string>
      <key>allowedImages</key>
      <dict>
        <key>enabled</key>
        <false/>
        <key>patterns</key>
        <array>
        </array>
      </dict>
    </dict>
    <key>virtualMachine</key>
    <dict>
      <key>memoryInGB</key>
      <integer>4</integer>
      <key>numberCPUs</key>
      <integer>2</integer>
      <key>type</key>
      <string>qemu</string>
      <key>useRosetta</key>
      <false/>
      <key>mount</key>
      <dict>
        <key>type</key>
        <string>reverse-sshfs</string>
      </dict>
    </dict>
    <key>kubernetes</key>
    <dict>
      <key>version</key>
      <string>1.27.3</string>
      <key>port</key>
      <integer>6443</integer>
      <key>enabled</key>
      <true/>
      <key>options</key>
      <dict>
        <key>traefik</key>
        <true/>
        <key>flannel</key>
        <true/>
      </dict>
      <key>ingress</key>
      <dict>
        <key>localhostOnly</key>
        <false/>
      </dict>
    </dict>
    <key>experimental</key>
    <dict>
      <key>virtualMachine</key>
      <dict>
        <key>mount</key>
        <dict>
          <key>9p</key>
          <dict>
            <key>securityModel</key>
            <string>none</string>
            <key>protocolVersion</key>
            <string>9p2000.L</string>
            <key>msizeInKib</key>
            <integer>128</integer>
            <key>cacheMode</key>
            <string>mmap</string>
          </dict>
        </dict>
        <key>proxy</key>
        <dict>
          <key>enabled</key>
          <false/>
          <key>address</key>
          <string></string>
          <key>password</key>
          <string></string>
          <key>port</key>
          <integer>3128</integer>
          <key>username</key>
          <string></string>
        </dict>
      </dict>
    </dict>
    <key>WSL</key>
    <dict>
      <key>integrations</key>
      <dict>
        <key>first</key>
        <true/>
        <key>second</key>
        <false/>
        <key>third</key>
        <true/>
      </dict>
    </dict>
    <key>portForwarding</key>
    <dict>
      <key>includeKubernetesServices</key>
      <false/>
    </dict>
    <key>images</key>
    <dict>
      <key>showAll</key>
      <true/>
      <key>namespace</key>
      <string>k8s.io</string>
    </dict>
    <key>diagnostics</key>
    <dict>
      <key>showMuted</key>
      <false/>
      <key>mutedChecks</key>
      <dict>
        <key>dial</key>
        <false/>
        <key>moss</key>
        <true/>
      </dict>
    </dict>
  </dict>
</plist>
`, s)
	})

	t.Run("Escapes problematic strings", func(t *testing.T) {
		jsonBody := `{ "application": {
										"extensions": {
											"allowed": {
											  "enabled": false,
											  "list": ["less-than:<", "greater:>", "and:&", "d-quote:\"", "emoji:😀"]
											},
											"installed": {
												"key-with-less-than: <": true,
												"key-with-ampersand: &": true,
												"key-with-greater-than: >": true,
												"key-with-emoji: 🐤": false
											}
										}
									},
									"containerEngine": {
									  "name": "name-less-<-than"
									}
							}
`
		s, err := JSONToPlist(jsonBody)
		assert.NoError(t, err)
		assert.Equal(t, `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
  <dict>
    <key>version</key>
    <integer>16</integer>
    <key>application</key>
    <dict>
      <key>extensions</key>
      <dict>
        <key>allowed</key>
        <dict>
          <key>enabled</key>
          <false/>
          <key>list</key>
          <array>
            <string>less-than:&lt;</string>
            <string>greater:&gt;</string>
            <string>and:&amp;</string>
            <string>d-quote:&#34;</string>
            <string>emoji:😀</string>
          </array>
        </dict>
        <key>installed</key>
        <dict>
          <key>key-with-ampersand: &amp;</key>
          <true/>
          <key>key-with-emoji: 🐤</key>
          <false/>
          <key>key-with-greater-than: &gt;</key>
          <true/>
          <key>key-with-less-than: &lt;</key>
          <true/>
        </dict>
      </dict>
    </dict>
    <key>containerEngine</key>
    <dict>
      <key>name</key>
      <string>name-less-&lt;-than</string>
    </dict>
  </dict>
</plist>
`, s)
	})
}
