# wsl-proxy port mappings

The wslproxy module defines the JSON that the WSL guest agent (`src/go/guestagent`) sends to wsl-proxy (`src/go/networking/cmd/proxy`) to add or remove port forwards.

Below is the json schema for PortMapping:

## schema
```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$ref": "#/$defs/PortMapping",
  "$defs": {
    "ConnectAddrs": {
      "properties": {
        "network": {
          "type": "string"
        },
        "addr": {
          "type": "string"
        }
      },
      "additionalProperties": false,
      "type": "object",
      "required": [
        "network",
        "addr"
      ]
    },
    "PortBinding": {
      "properties": {
        "HostIp": {
          "type": "string"
        },
        "HostPort": {
          "type": "string"
        }
      },
      "additionalProperties": false,
      "type": "object",
      "required": [
        "HostIp",
        "HostPort"
      ]
    },
    "PortMap": {
      "patternProperties": {
        ".*": {
          "items": {
            "$ref": "#/$defs/PortBinding"
          },
          "type": "array"
        }
      },
      "type": "object"
    },
    "PortMapping": {
      "properties": {
        "remove": {
          "type": "boolean"
        },
        "ports": {
          "$ref": "#/$defs/PortMap"
        },
        "connectAddrs": {
          "items": {
            "$ref": "#/$defs/ConnectAddrs"
          },
          "type": "array"
        }
      },
      "additionalProperties": false,
      "type": "object",
      "required": [
        "remove",
        "ports",
        "connectAddrs"
      ]
    }
  }
}
```