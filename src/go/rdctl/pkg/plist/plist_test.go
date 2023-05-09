package plist

import (
	"github.com/stretchr/testify/assert"
	"testing"
)

func TestJsonToPlistFormat(t *testing.T) {
	t.Run("handles empty bodies", func(t *testing.T) {
		s, err := JsonToPlist("{}")
		assert.NoError(t, err)
		assert.Equal(t, `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
  <dict/>
</plist>
`, s)
	})

	t.Run("Handles arrays", func(t *testing.T) {
		jsonBody := `{"application": { "extensions": { "allowed": {
        "enabled": false,
        "list": ["wink", "blink", "drink"]
     } } }, "containerEngine": { "name": "beatrice" }}`
		s, err := JsonToPlist(jsonBody)
		assert.NoError(t, err)
		assert.Equal(t, `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
  <dict>
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
    "numberCPUs": 2,
    "hostResolver": true
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
      "type": "qemu",
      "useRosetta": false,
      "socketVMNet": false,
      "mount": {
        "type": "reverse-sshfs",
        "9p": {
          "securityModel": "none",
          "protocolVersion": "9p2000.L",
          "msizeInKib": 128,
          "cacheMode": "mmap"
        }
      },
      "networkingTunnel": false,
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
		s, err := JsonToPlist(jsonBody)
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
      </dict>
    </dict>
    <key>virtualMachine</key>
    <dict>
      <key>memoryInGB</key>
      <integer>4</integer>
      <key>numberCPUs</key>
      <integer>2</integer>
      <key>hostResolver</key>
      <true/>
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
        <key>socketVMNet</key>
        <false/>
        <key>mount</key>
        <dict>
          <key>type</key>
          <string>reverse-sshfs</string>
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
        <key>networkingTunnel</key>
        <false/>
        <key>type</key>
        <string>qemu</string>
        <key>useRosetta</key>
        <false/>
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
}
