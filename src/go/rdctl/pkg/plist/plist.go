// Package reg is responsible for converting ServerSettingsForJSON structures into
// importable Windows registry files by running `reg import FILE`.
//
// Note that the `reg` command must be run with administrator privileges because it
// modifies either a section of `HKEY_LOCAL_MACHINE` or `HKEY_CURRENT_USER\SOFTWARE\Policies`,
// both of which require escalated privileges to be modified.

package plist

import (
	"encoding/json"
	"fmt"
	options "github.com/rancher-sandbox/rancher-desktop/src/go/rdctl/pkg/options/generated"
	"reflect"
	"sort"

	"strings"
)

func xmlEscape(s string) string {
	s1 := strings.ReplaceAll(s, "&", "&amp;")
	s2 := strings.ReplaceAll(s1, "<", "&lt;")
	s3 := strings.ReplaceAll(s2, ">", "&gt;")
	return s3
}

const indentChange = "  "

type mapKeyWithString struct {
	mapKey    reflect.Value
	stringKey string
}

func sortKeys(mapKeys []reflect.Value) []mapKeyWithString {
	retVals := make([]mapKeyWithString, len(mapKeys))
	for idx, key := range mapKeys {
		mapKeyAsString := key.String()
		retVals[idx] = mapKeyWithString{key, mapKeyAsString}
	}
	sort.Slice(retVals, func(i, j int) bool {
		return retVals[i].stringKey < retVals[j].stringKey
	})
	return retVals
}

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
			retLines[i+1] = fmt.Sprintf("%s<string>%s</string>", indent+indentChange, xmlEscape(v.Index(i).String()))
		}
		retLines[numValues+1] = indent + "</array>"
		return retLines, nil
	case reflect.Map:
		numValues := len(v.MapKeys())
		if numValues == 0 {
			return nil, nil
		}
		returnedLines := []string{indent + "<dict>"}
		typedKeys := sortKeys(v.MapKeys())
		for _, typedKey := range typedKeys {
			keyAsString := typedKey.stringKey
			innerLines, err := convertToPListLines(v.MapIndex(typedKey.mapKey), indent+indentChange)
			if err != nil {
				return nil, err
			} else if len(innerLines) > 0 {
				returnedLines = append(returnedLines, fmt.Sprintf(`%s<key>%s</key>`, indent+indentChange, keyAsString))
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
		return []string{fmt.Sprintf("%s<string>%s</string>", indent, xmlEscape(v.String()))}, nil
	}
	return nil, fmt.Errorf("convertToPListLines: don't know how to process kind: %s, (%T), value: %v", kind, v, v)
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
