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
	"reflect"
	"strings"

	options "github.com/rancher-sandbox/rancher-desktop/src/go/rdctl/pkg/options/generated"
	"github.com/rancher-sandbox/rancher-desktop/src/go/rdctl/pkg/utils"
)

const indentChange = "  "

// convertToPListLines recursively reflects the supplied value into lines for a plist

// structType: type information on the current field for the `value` parameter
// value: the reflected value of the current field, based on a simple map[string]interface{} JSON-parse
// indent: the leading whitespace for each line so the generated XML is more readable
// path: a dotted representation of the fully-qualified name of the field
//
// Returns two values:
//
//	an array of lines representing the generated XML
//	an error: the only non-nil error this function can return is when it encounters an unhandled data type

func convertToPListLines(structType reflect.Type, value reflect.Value, indent, path string) ([]string, error) {
	kind := structType.Kind()
	if value.Kind() == reflect.Interface && kind != reflect.Interface {
		if value.IsNil() {
			return nil, nil
		}
		return convertToPListLines(structType, value.Elem(), indent, path)
	}
	if value.Kind() == reflect.Ptr {
		return nil, fmt.Errorf("plist generation: got an unexpected pointer for %s value %v, expecting type %v", path, value, structType)
	}
	switch kind {
	case reflect.Struct:
		if value.Kind() != reflect.Map {
			return nil, fmt.Errorf("expecting actual kind for a typed struct %s to be a map, got %v", path, value.Kind())
		}
		numTypedFields := structType.NumField()
		returnedLines := []string{indent + "<dict>"}
		// Typed fields are ordered according to options.ServerSettingsForJSON
		// By walking the list of fields in the structure type, and expanding only those fields
		// that are specifed, we get a consistent order in the output
		// (e.g. `updater` always appears before `autoStart` in `application`
		for i := 0; i < numTypedFields; i++ {
			field := structType.Field(i)
			fieldName, _, _ := strings.Cut(field.Tag.Get("json"), ",")
			valueElement := value.MapIndex(reflect.ValueOf(fieldName))
			if valueElement.IsValid() {
				newRetLines, err := convertToPListLines(field.Type, valueElement, indent+indentChange, path+"."+fieldName)
				if err != nil {
					return nil, err
				}
				returnedLines = append(returnedLines, fmt.Sprintf(`%s<key>%s</key>`, indent+indentChange, fieldName))
				returnedLines = append(returnedLines, newRetLines...)
			}
		}
		if len(returnedLines) == 1 {
			return nil, nil
		}
		returnedLines = append(returnedLines, indent+"</dict>")
		return returnedLines, nil
	case reflect.Ptr:
		return convertToPListLines(structType.Elem(), value, indent, path)
	case reflect.Slice, reflect.Array:
		if value.Kind() != reflect.Slice && value.Kind() != reflect.Array {
			return nil, fmt.Errorf("expected slice or array at %s, got %v", path, value.Kind())
		}
		// Currently, all arrays in the options are arrays of strings
		numValues := value.Len()
		retLines := make([]string, numValues+2)
		retLines[0] = indent + "<array>"
		for i := 0; i < numValues; i++ {
			item := value.Index(i)
			for item.Kind() == reflect.Interface || item.Kind() == reflect.Pointer {
				item = item.Elem()
			}
			escapedString, err := xmlEscapeText(item.String())
			if err != nil {
				return nil, err
			}
			retLines[i+1] = fmt.Sprintf("%s<string>%s</string>", indent+indentChange, escapedString)
		}
		retLines[numValues+1] = indent + "</array>"
		return retLines, nil
	case reflect.Map:
		returnedLines := []string{indent + "<dict>"}
		mapKeys := utils.SortKeys(value.MapKeys())
		for _, mapKey := range mapKeys {
			keyAsString := mapKey.StringKey
			innerLines, err := convertToPListLines(structType.Elem(), value.MapIndex(mapKey.MapKey), indent+indentChange, path+"."+keyAsString)
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
		returnedLines = append(returnedLines, indent+"</dict>")
		return returnedLines, nil
	case reflect.Interface:
		// Since we allow whatever here, just use the actual type of the value.
		// But if it's an interface{} we'll need to dereference it first to avoid
		// an infinite loop.
		for value.Kind() == reflect.Interface {
			value = value.Elem()
		}
		return convertToPListLines(value.Type(), value, indent, path)
	case reflect.Bool:
		boolValue := map[bool]string{true: "true", false: "false"}[value.Bool()]
		return []string{fmt.Sprintf("%s<%s/>", indent, boolValue)}, nil
	case reflect.Int, reflect.Int8, reflect.Int16,
		reflect.Int32, reflect.Uint, reflect.Uint8, reflect.Uint16,
		reflect.Uint32, reflect.Int64, reflect.Uint64:
		if value.CanConvert(reflect.TypeOf(int64(0))) {
			value = value.Convert(reflect.TypeOf(int64(0)))
		}
		return []string{fmt.Sprintf("%s<integer>%d</integer>", indent, value.Int())}, nil
	case reflect.Float32:
		return []string{fmt.Sprintf("%s<float>%f</float>", indent, value.Float())}, nil
	case reflect.String:
		escapedString, err := xmlEscapeText(value.String())
		if err != nil {
			return nil, err
		}
		return []string{fmt.Sprintf("%s<string>%s</string>", indent, escapedString)}, nil
	}
	return nil, fmt.Errorf("convertToPListLines: don't know how to process %s kind: %q, (%T), value: %v", path, kind, structType, value)
}

func xmlEscapeText(s string) (string, error) {
	recvBuffer := &bytes.Buffer{}
	err := xml.EscapeText(recvBuffer, []byte(s))
	if err != nil {
		return "", err
	}
	return recvBuffer.String(), nil
}

// JsonToPlist converts the json settings to plist-compatible xml text.
func JsonToPlist(settingsBodyAsJSON string) (string, error) {
	var actualSettingsJSON map[string]interface{}

	if err := json.Unmarshal([]byte(settingsBodyAsJSON), &actualSettingsJSON); err != nil {
		return "", fmt.Errorf("error in json: %s", err)
	}
	// We use the type as a schema, mainly to distinguish the absence of an array or map from an empty instance
	// - see https://github.com/golang/go/issues/27589
	// And the reason why the type-free parse isn't sufficient is that it doesn't distinguish
	// hashes (like `diagnostics.mutedChecks`) from subtrees.
	// By walking the two data structures in parallel the converter can figure out exactly which fields were specified,
	// and how to interpret their values.
	lines, err := convertToPListLines(reflect.TypeOf(options.ServerSettingsForJSON{}), reflect.ValueOf(actualSettingsJSON), indentChange, "")
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
