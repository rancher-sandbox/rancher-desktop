package reg

import (
	"fmt"
	"sort"
	"testing"

	"github.com/stretchr/testify/assert"

	options "github.com/rancher-sandbox/rancher-desktop/src/go/rdctl/pkg/options/generated"
)

const (
	DefaultsHeader = "HKEY_CURRENT_USER\\SOFTWARE\\Policies\\Rancher Desktop\\defaults"
)

func TestJsonToRegFormat(t *testing.T) {
	t.Run("complains about bad arguments", func(t *testing.T) {
		type errorTestCases struct {
			hiveType      string
			profileType   string
			expectedError string
		}
		testCases := []errorTestCases{
			{
				hiveType:      "bad-hive",
				profileType:   "defaults",
				expectedError: `unrecognized hiveType of "bad-hive", must be "hklm" or "hkcu"`,
			},
			{
				hiveType:      "bad-hive",
				profileType:   "locked",
				expectedError: `unrecognized hiveType of "bad-hive", must be "hklm" or "hkcu"`,
			},
			{
				hiveType:      "hkcu",
				profileType:   "bad-profile",
				expectedError: `unrecognized profileType of "bad-profile", must be "defaults" or "locked"`,
			},
			{
				hiveType:      "hklm",
				profileType:   "bad-profile",
				expectedError: `unrecognized profileType of "bad-profile", must be "defaults" or "locked"`,
			},
		}
		for _, testCase := range testCases {
			t.Run(fmt.Sprintf("%s:%s", testCase.hiveType, testCase.profileType), func(t *testing.T) {
				_, err := JSONToReg(testCase.hiveType, testCase.profileType, "")
				assert.ErrorContains(t, err, testCase.expectedError)
			})
		}
	})
	t.Run("handles empty bodies", func(t *testing.T) {
		lines, err := JSONToReg("hkcu", "defaults", "{}")
		assert.NoError(t, err)
		assert.NoError(t, err)
		assert.Equal(t, fmt.Sprintf("[%s]", DefaultsHeader), lines[3])
		assert.Equal(t, 5, len(lines))
		assert.Equal(t, "Windows Registry Editor Version 5.00", lines[0])
		assert.Equal(t, "[HKEY_CURRENT_USER\\SOFTWARE\\Policies]", lines[1])
		assert.Equal(t, "[HKEY_CURRENT_USER\\SOFTWARE\\Policies\\Rancher Desktop]", lines[2])
		assert.Equal(t, "[HKEY_CURRENT_USER\\SOFTWARE\\Policies\\Rancher Desktop\\defaults]", lines[3])
		assert.Equal(t, fmt.Sprintf(`"version"=dword:%02x`, options.CURRENT_SETTINGS_VERSION), lines[4])
	})
	t.Run("converts the registry-type arguments into reg headers", func(t *testing.T) {
		type testCaseType struct {
			hiveType       string
			profileType    string
			expectedHeader string
		}
		testCases := []testCaseType{
			{
				hiveType:       "hkcu",
				profileType:    "defaults",
				expectedHeader: DefaultsHeader,
			},
			{
				hiveType:       "hklm",
				profileType:    "defaults",
				expectedHeader: "HKEY_LOCAL_MACHINE\\SOFTWARE\\Policies\\Rancher Desktop\\defaults",
			},
			{
				hiveType:       "hkcu",
				profileType:    "locked",
				expectedHeader: "HKEY_CURRENT_USER\\SOFTWARE\\Policies\\Rancher Desktop\\locked",
			},
			{
				hiveType:       "hklm",
				profileType:    "locked",
				expectedHeader: "HKEY_LOCAL_MACHINE\\SOFTWARE\\Policies\\Rancher Desktop\\locked",
			},
		}
		jsonBody := `{"version": 19, "application": { "pathManagementStrategy": "manual" } }`
		for _, testCase := range testCases {
			t.Run(fmt.Sprintf("%s:%s", testCase.hiveType, testCase.profileType), func(t *testing.T) {
				lines, err := JSONToReg(testCase.hiveType, testCase.profileType, jsonBody)
				assert.NoError(t, err)
				assert.Equal(t, 7, len(lines))
				assert.Equal(t, fmt.Sprintf("[%s]", testCase.expectedHeader), lines[3])
				assert.Equal(t, `"version"=dword:13`, lines[4])
				assert.Equal(t, fmt.Sprintf("[%s\\application]", testCase.expectedHeader), lines[5])
				assert.Equal(t, `"pathManagementStrategy"="manual"`, lines[6])
			})
		}
	})

	t.Run("Handles arrays", func(t *testing.T) {
		jsonBody := `{"application": { "extensions": { "allowed": {
        "enabled": false,
        "list": ["wink", "blink", "drink"]
     } } }, "containerEngine": { "name": "beatrice" }}`
		header := "HKEY_CURRENT_USER\\SOFTWARE\\Policies\\Rancher Desktop\\defaults"
		lines, err := JSONToReg("hkcu", "defaults", jsonBody)
		assert.NoError(t, err)
		assert.Equal(t, 12, len(lines))
		assert.Equal(t, fmt.Sprintf("[%s]", header), lines[3])
		assert.Equal(t, fmt.Sprintf(`"version"=dword:%02x`, options.CURRENT_SETTINGS_VERSION), lines[4])
		assert.Equal(t, fmt.Sprintf("[%s\\application]", header), lines[5])
		assert.Equal(t, fmt.Sprintf("[%s\\application\\extensions]", header), lines[6])
		assert.Equal(t, fmt.Sprintf("[%s\\application\\extensions\\allowed]", header), lines[7])
		assert.Equal(t, `"enabled"=dword:0`, lines[8])
		assert.Equal(t, `"list"=hex(7):77,00,69,00,6e,00,6b,00,00,00,62,00,6c,00,69,00,6e,00,6b,00,00,00,64,00,72,00,69,00,6e,00,6b,00,00,00,00,00`, lines[9])
		assert.Equal(t, fmt.Sprintf("[%s\\containerEngine]", header), lines[10])
		assert.Equal(t, `"name"="beatrice"`, lines[11])
	})

	t.Run("Handles maps", func(t *testing.T) {
		jsonBody := `{
 "WSL": {
   "integrations": {
			"fish": true,
			"sheep": false,
			"cows": 17,
			"owls": "stuff"
		}
  }
}`
		header := "HKEY_CURRENT_USER\\SOFTWARE\\Policies\\Rancher Desktop\\defaults"
		lines, err := JSONToReg("hkcu", "defaults", jsonBody)
		assert.NoError(t, err)
		assert.Equal(t, 11, len(lines))
		assert.Equal(t, fmt.Sprintf("[%s\\WSL]", header), lines[5])
		assert.Equal(t, fmt.Sprintf("[%s\\WSL\\integrations]", header), lines[6])

		// maps aren't processed in json-order, so allow any order
		expectedMapValues := []string{`"fish"=dword:1`, `"sheep"=dword:0`, `"owls"="stuff"`, `"cows"=dword:11`}
		receivedMapValues := lines[7:11]
		sort.Strings(expectedMapValues)
		sort.Strings(receivedMapValues)
		assert.Equal(t, expectedMapValues, receivedMapValues)
	})
	t.Run("In each node, it first writes out scalar values before writing out sub-objects", func(t *testing.T) {
		jsonBody := `{
  "version": 8,
  "application": {
    "adminAccess": false,
    "extensions": {
      "allowed": {
        "enabled": false,
        "list": []
      }
    },
    "pathManagementStrategy": "manual",
    "updater": {
      "enabled": false
    },
    "autoStart": false
  },
  "containerEngine": {
    "allowedImages": {
      "patterns": ["fable", "there", "crazy", "whine"],
      "enabled": false
    },
    "name": "moby"
  }
}`
		lines, err := JSONToReg("hkcu", "defaults", jsonBody)
		assert.NoError(t, err)
		expectedLines := []string{
			`Windows Registry Editor Version 5.00`,
			`[HKEY_CURRENT_USER\SOFTWARE\Policies]`,
			`[HKEY_CURRENT_USER\SOFTWARE\Policies\Rancher Desktop]`,
			`[HKEY_CURRENT_USER\SOFTWARE\Policies\Rancher Desktop\defaults]`,
			`"version"=dword:8`,
			`[HKEY_CURRENT_USER\SOFTWARE\Policies\Rancher Desktop\defaults\application]`,
			`"adminAccess"=dword:0`,
			`"autoStart"=dword:0`,
			`"pathManagementStrategy"="manual"`,
			`[HKEY_CURRENT_USER\SOFTWARE\Policies\Rancher Desktop\defaults\application\extensions]`,
			`[HKEY_CURRENT_USER\SOFTWARE\Policies\Rancher Desktop\defaults\application\extensions\allowed]`,
			`"enabled"=dword:0`,
			`"list"=hex(7):00,00`,
			`[HKEY_CURRENT_USER\SOFTWARE\Policies\Rancher Desktop\defaults\application\updater]`,
			`"enabled"=dword:0`,
			`[HKEY_CURRENT_USER\SOFTWARE\Policies\Rancher Desktop\defaults\containerEngine]`,
			`"name"="moby"`,
			`[HKEY_CURRENT_USER\SOFTWARE\Policies\Rancher Desktop\defaults\containerEngine\allowedImages]`,
			`"enabled"=dword:0`,
			`"patterns"=hex(7):66,00,61,00,62,00,6c,00,65,00,00,00,74,00,68,00,65,00,72,00,65,00,00,00,63,00,72,00,61,00,7a,00,79,00,00,00,77,00,68,00,69,00,6e,00,65,00,00,00,00,00`,
		}
		assert.Equal(t, 20, len(lines))
		assert.Equal(t, expectedLines, lines)
	})
	t.Run("It handles a full settings file", func(t *testing.T) {
		jsonBody := `{
  "version": 8,
  "application": {
    "adminAccess": false,
    "debug": true,
    "extensions": {
      "allowed": {
        "enabled": false,
        "list": ["found", "fully", "bawdy", "tarot"]
      },
			"installed": {
					 "timeCheck1": "a",
					 "timeCheck2": "b"
			 }
    },
    "pathManagementStrategy": "manual",
    "telemetry": {
      "enabled": true
    },
    "updater": {
      "enabled": false
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
      "patterns": ["fable", "there", "crazy", "whine"]
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
		  "butte" : true, "assay": false, "moron": 55, "hovel":"stuff"
		}
  },
  "kubernetes": {
    "version": "1.25.9",
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
       "check1": true,
       "check2": false
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
		lines, err := JSONToReg("hkcu", "defaults", jsonBody)
		assert.NoError(t, err)
		assert.Equal(t, 76, len(lines))
	})
}
