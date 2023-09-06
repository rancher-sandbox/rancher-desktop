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

// typedValue: the reflected value of the current field, according to the ServerSettingsForJSON struct
//             - this variable distinguishes structs from maps (like diagnostics.mutedChecks)
// actualValue: the reflected value of the current field, based on a simple map[string]interface{} JSON-parse
//             - this variable distinguishes empty arrays/maps from unspecified ones (which won't show up)
// indent: the leading whitespace for each line so the generated XML is more readable
//
// Returns two values:
//
//	an array of lines representing the generated XML
//	an error: the only non-nil error this function can return is when it encounters an unhandled data type

func convertToPListLines(typedValue, actualValue reflect.Value, indent string) ([]string, error) {
	kind := typedValue.Kind()
	if actualValue.Kind() == reflect.Interface && typedValue.Kind() != reflect.Interface {
		if actualValue.IsNil() {
			return nil, nil
		}
		return convertToPListLines(typedValue, actualValue.Elem(), indent)
	}
	if actualValue.Kind() == reflect.Ptr {
		return nil, fmt.Errorf("plist generation: got an unexpected pointer for value %v, typedValue %v", actualValue, typedValue)
	}
	switch kind {
	case reflect.Struct:
		if actualValue.Kind() != reflect.Map {
			return nil, fmt.Errorf("expecting actual kind for a typed struct to be a map, got %v", actualValue.Kind())
		}
		actualKeys := utils.SortKeys(actualValue.MapKeys())
		numTypedFields := typedValue.NumField()
		returnedLines := []string{indent + "<dict>"}
		// Typed fields are ordered according to options.ServerSettingsForJSON
		// Actual fields are sorted by key (ignoring case), so walk the list of declared keys
		// and take only the ones that appear in the actual instance. This gives a consistent,
		// if not immediately obvious, order.
		for i := 0; i < numTypedFields; i++ {
			fieldTag := typedValue.Type().Field(i).Tag.Get("json")
			fieldName, _, _ := strings.Cut(fieldTag, ",")
			for _, actualKey := range actualKeys {
				keyAsString := actualKey.StringKey
				if keyAsString == fieldName {
					newRetLines, err := convertToPListLines(typedValue.Field(i), actualValue.MapIndex(actualKey.MapKey), indent+indentChange)
					if err != nil {
						return nil, err
					}
					returnedLines = append(returnedLines, fmt.Sprintf(`%s<key>%s</key>`, indent+indentChange, keyAsString))
					returnedLines = append(returnedLines, newRetLines...)
					break
				}
			}
		}
		if len(returnedLines) == 1 {
			return nil, nil
		}
		returnedLines = append(returnedLines, indent+"</dict>")
		return returnedLines, nil
	case reflect.Ptr:
		return convertToPListLines(typedValue.Elem(), actualValue, indent)
	case reflect.Slice, reflect.Array:
		// Currently, all arrays in the options are arrays of strings
		numValues := typedValue.Len()
		retLines := make([]string, numValues+2)
		retLines[0] = indent + "<array>"
		for i := 0; i < numValues; i++ {
			escapedString, err := xmlEscapeText(typedValue.Index(i).String())
			if err != nil {
				return nil, err
			}
			retLines[i+1] = fmt.Sprintf("%s<string>%s</string>", indent+indentChange, escapedString)
		}
		retLines[numValues+1] = indent + "</array>"
		return retLines, nil
	case reflect.Map:
		returnedLines := []string{indent + "<dict>"}
		actualKeys := utils.SortKeys(actualValue.MapKeys())
		for _, actualKey := range actualKeys {
			keyAsString := actualKey.StringKey
			// If it's a map (always of string => bool|string|int), the typed and actual values are the same
			// The only difference is that if the field isn't specified in the input, there will be an instance
			// in `typedValue` but not `actualValue`.
			innerLines, err := convertToPListLines(typedValue.MapIndex(actualKey.MapKey), actualValue.MapIndex(actualKey.MapKey), indent+indentChange)
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
		// Should be no more typed-value interfaces
		return convertToPListLines(typedValue.Elem(), actualValue, indent)
	case reflect.Bool:
		boolValue := map[bool]string{true: "true", false: "false"}[typedValue.Bool()]
		return []string{fmt.Sprintf("%s<%s/>", indent, boolValue)}, nil
	case reflect.Int, reflect.Int8, reflect.Int16,
		reflect.Int32, reflect.Uint, reflect.Uint8, reflect.Uint16,
		reflect.Uint32, reflect.Int64, reflect.Uint64:
		return []string{fmt.Sprintf("%s<integer>%d</integer>", indent, typedValue.Int())}, nil
	case reflect.Float32:
		return []string{fmt.Sprintf("%s<float>%f</float>", indent, typedValue.Float())}, nil
	case reflect.String:
		escapedString, err := xmlEscapeText(typedValue.String())
		if err != nil {
			return nil, err
		}
		return []string{fmt.Sprintf("%s<string>%s</string>", indent, escapedString)}, nil
	}
	return nil, fmt.Errorf("convertToPListLines: don't know how to process kind: %q, (%T), value: %v", kind, typedValue, actualValue)
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
	var schemaInfluencedSettingsJSON options.ServerSettingsForJSON
	var actualSettingsJSON map[string]interface{}

	if err := json.Unmarshal([]byte(settingsBodyAsJSON), &schemaInfluencedSettingsJSON); err != nil {
		return "", fmt.Errorf("error in json: %s", err)
	}
	if err := json.Unmarshal([]byte(settingsBodyAsJSON), &actualSettingsJSON); err != nil {
		return "", fmt.Errorf("error in json: %s", err)
	}
	// `convertToPListLines`` needs two JSON representations of the incoming data: one based on the schema,
	// and the second based on a type-free JSON parse of the data.
	// The object built from using `options.ServerSettingsForJSON` to guide the JSON parser acts like a schema.
	// The object built from using `map[string]interface{}` shows us exactly which fields were specified,
	// but needs interpretation.
	//
	// The reason for the two is that the `schemaInfluencedSettingsJSON` doesn't distinguish empty arrays and dicts
	// from unspecified ones.
	// This is a known issue in go - see https://github.com/golang/go/issues/27589
	// And the reason why the type-free parse isn't sufficient is that it doesn't distinguish
	// hashes (like `diagnostics.mutedChecks`) from subtrees.
	// By walking the two data structures in parallel the converter can figure out exactly which fields were specified,
	// and how to interpret their values.
	lines, err := convertToPListLines(reflect.ValueOf(schemaInfluencedSettingsJSON), reflect.ValueOf(actualSettingsJSON), indentChange)
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
