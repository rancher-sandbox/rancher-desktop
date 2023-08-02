// This package exists because I looked at three commonly used JSON->PLIST transformers/encoders.
// One of them (vinzenz/go-plist) was too low-level, and the other two
// (distatus/go-plist and howett.net/plist) ignored the `omitempty` directive in structure tags,
// producing a large number of '<dict></dict>' sequences in the generated output.
//
// We already had a module that used reflection to convert objects into REGISTRY files, so it wasn't
// very hard to take the same code and repurpose it to generate minimal plist files. One could make a
// case that using a hardened XML library will avoid encoding problems, but given that we deal with
// Hence this package.

package plist

import (
	"bytes"
	"encoding/json"
	"encoding/xml"
	"fmt"
	options "github.com/rancher-sandbox/rancher-desktop/src/go/rdctl/pkg/options/generated"
	"reflect"

	"github.com/rancher-sandbox/rancher-desktop/src/go/rdctl/pkg/utils"
	"strings"
)

const indentChange = "  "

// convertToPListLines recursively reflects the supplied value into lines for a plist
func convertToPListLines(v reflect.Value, indent string) ([]string, error) {
	kind := v.Kind()
	switch kind {
	case reflect.Struct:
		numFields := v.NumField()
		returnedLines := []string{indent + "<dict>"}
		for i := 0; i < numFields; i++ {
			fieldTag := v.Type().Field(i).Tag.Get("json")
			fieldName := strings.Replace(fieldTag, ",omitempty", "", 1)
			newRetLines, err := convertToPListLines(v.Field(i), indent+indentChange)
			if err != nil {
				return nil, err
			}
			if len(newRetLines) == 0 {
				continue
			}
			returnedLines = append(returnedLines, fmt.Sprintf(`%s<key>%s</key>`, indent+indentChange, fieldName))
			returnedLines = append(returnedLines, newRetLines...)
		}
		if len(returnedLines) == 1 {
			return nil, nil
		}
		returnedLines = append(returnedLines, indent+"</dict>")
		return returnedLines, nil
	case reflect.Ptr:
		if v.IsNil() {
			return nil, nil
		} else {
			return convertToPListLines(v.Elem(), indent)
		}
	case reflect.Slice, reflect.Array:
		// Currently, all arrays in the options are arrays of strings
		numValues := v.Len()
		if numValues == 0 {
			return nil, nil
		}
		retLines := make([]string, numValues+2)
		retLines[0] = indent + "<array>"
		for i := 0; i < numValues; i++ {
			escapedString, err := xmlEscapeText(v.Index(i).String())
			if err != nil {
				return nil, err
			}
			retLines[i+1] = fmt.Sprintf("%s<string>%s</string>", indent+indentChange, escapedString)
		}
		retLines[numValues+1] = indent + "</array>"
		return retLines, nil
	case reflect.Map:
		numValues := len(v.MapKeys())
		if numValues == 0 {
			return nil, nil
		}
		returnedLines := []string{indent + "<dict>"}
		typedKeys := utils.SortKeys(v.MapKeys())
		for _, typedKey := range typedKeys {
			keyAsString := typedKey.StringKey
			innerLines, err := convertToPListLines(v.MapIndex(typedKey.MapKey), indent+indentChange)
			if err != nil {
				return nil, err
			} else if len(innerLines) > 0 {
				escapedString, err := xmlEscapeText(keyAsString)
				if err != nil {
					return nil, err
				}
				returnedLines = append(returnedLines, fmt.Sprintf(`%s<key>%s</key>`, indent+indentChange, escapedString))
				returnedLines = append(returnedLines, innerLines...)
			}
		}
		if len(returnedLines) == 1 {
			return nil, nil
		}
		returnedLines = append(returnedLines, indent+"</dict>")
		return returnedLines, nil
	case reflect.Interface:
		if v.IsNil() {
			return nil, nil
		}
		return convertToPListLines(v.Elem(), indent)
	case reflect.Bool:
		boolValue := map[bool]string{true: "true", false: "false"}[v.Bool()]
		return []string{fmt.Sprintf("%s<%s/>", indent, boolValue)}, nil
	case reflect.Int, reflect.Int8, reflect.Int16,
		reflect.Int32, reflect.Uint, reflect.Uint8, reflect.Uint16,
		reflect.Uint32, reflect.Int64, reflect.Uint64:
		return []string{fmt.Sprintf("%s<integer>%d</integer>", indent, v.Int())}, nil
	case reflect.Float32:
		return []string{fmt.Sprintf("%s<float>%f</float>", indent, v.Float())}, nil
	case reflect.String:
		escapedString, err := xmlEscapeText(v.String())
		if err != nil {
			return nil, err
		}
		return []string{fmt.Sprintf("%s<string>%s</string>", indent, escapedString)}, nil
	}
	return nil, fmt.Errorf("convertToPListLines: don't know how to process kind: %s, (%T), value: %v", kind, v, v)
}

func xmlEscapeText(s string) (string, error) {
	recvBuffer := &bytes.Buffer{}
	err := xml.EscapeText(recvBuffer, []byte(s))
	if err != nil {
		return "", err
	}
	return recvBuffer.String(), nil
}

// JsonToPlist converts the json settings to a reg file
func JsonToPlist(settingsBodyAsJSON string) (string, error) {
	var settingsJSON options.ServerSettingsForJSON

	if err := json.Unmarshal([]byte(settingsBodyAsJSON), &settingsJSON); err != nil {
		return "", fmt.Errorf("error in json: %s\n", err)
	}
	lines, err := convertToPListLines(reflect.ValueOf(settingsJSON), indentChange)
	if err != nil {
		return "", err
	}
	headerLines := []string{`<?xml version="1.0" encoding="UTF-8"?>`,
		`<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">`,
		`<plist version="1.0">`,
	}
	trailerLines := []string{"</plist>", ""}
	if len(lines) == 0 {
		lines = []string{"  <dict/>"}
	}
	headerLines = append(headerLines, lines...)
	headerLines = append(headerLines, trailerLines...)
	return strings.Join(headerLines, "\n"), nil
}
