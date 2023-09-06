// Package reg is responsible for converting ServerSettingsForJSON structures into
// importable Windows registry files by running `reg import FILE`.
//
// Note that the `reg` command must be run with administrator privileges because it
// modifies either a section of `HKEY_LOCAL_MACHINE` or `HKEY_CURRENT_USER\SOFTWARE\Policies`,
// both of which require escalated privileges to be modified.

package reg

import (
	"encoding/json"
	"fmt"
	options "github.com/rancher-sandbox/rancher-desktop/src/go/rdctl/pkg/options/generated"
	"github.com/rancher-sandbox/rancher-desktop/src/go/rdctl/pkg/utils"
	"reflect"
	"strings"
	"unicode/utf16"
)

const HkcuRegistryHive = "hkcu"
const HklmRegistryHive = "hklm"

func escape(s string) string {
	s1 := strings.ReplaceAll(s, "\\", "\\\\")
	return strings.ReplaceAll(s1, `"`, `\\"`)
}

// convertToRegFormat recursively reflects the supplied value into lines for a reg file
//
// Params:
// pathParts: represents the registry path to the current item
// typedValue: the reflected value of the current field, according to the ServerSettingsForJSON struct
//   - this variable distinguishes structs from maps (like diagnostics.mutedChecks)
//
// actualValue: the reflected value of the current field, based on a simple map[string]interface{} JSON-parse
//   - this variable distinguishes empty arrays/maps from unspecified ones (which won't show up)
//
// jsonTag: the name of the field, used in json (and the registry)
//
// Returns two values:
//
//	an array of lines representing the current value
//	an error: the only non-nil error this function can return is when it encounters an unhandled value type
func convertToRegFormat(pathParts []string, typedValue, actualValue reflect.Value, jsonTag string) ([]string, error) {
	kind := typedValue.Kind()
	if actualValue.Kind() == reflect.Interface && typedValue.Kind() != reflect.Interface {
		if actualValue.IsNil() {
			return nil, nil
		}
		return convertToRegFormat(pathParts, typedValue, actualValue.Elem(), jsonTag)
	}
	if actualValue.Kind() == reflect.Ptr {
		return nil, fmt.Errorf("reg-file generation: got an unexpected pointer for value %v, typedValue %v", actualValue, typedValue)
	}
	switch kind {
	case reflect.Struct:
		// This is very different from plist-processing of structs.
		// In the plist world we want to preserve order of fields in the original JSON,
		// because that's what the plutil converter does.
		// In the registry world better to order the fields alphabetically
		//
		if actualValue.Kind() != reflect.Map {
			return nil, fmt.Errorf("expecting actual kind for a typed struct to be a map, got %v", actualValue.Kind())
		}
		actualKeys := utils.SortKeys(actualValue.MapKeys())
		numTypedFields := typedValue.NumField()
		typedFieldNames := make([]string, numTypedFields, numTypedFields)
		for i := 0; i < numTypedFields; i++ {
			fieldTag := typedValue.Type().Field(i).Tag.Get("json")
			fieldName, _, _ := strings.Cut(fieldTag, ",")
			typedFieldNames[i] = fieldName
		}
		scalarReturnedLines := make([]string, 0, numTypedFields)
		nestedReturnedLines := make([]string, 0)
		for _, actualKey := range actualKeys {
			keyAsString := actualKey.StringKey
			typedFieldIndex := utils.FindTypedFieldIndex(keyAsString, typedValue, numTypedFields)
			if typedFieldIndex == -1 {
				return nil, fmt.Errorf("plist generation: no instance of key %s (value %v) in the struct %v", keyAsString, actualValue, typedValue)
			}
			newRetLines, err := convertToRegFormat(append(pathParts, keyAsString), typedValue.Field(typedFieldIndex), actualValue.MapIndex(actualKey.MapKey), keyAsString)
			if err != nil {
				return nil, err
			}
			if len(newRetLines) == 0 {
				continue
			}
			// With the current schema, only structs may contain nested structs.
			// If the first character of the first line is a '[' it's a struct. Otherwise it's a scalar.
			// ']' placed here to appease my IDE's linter.
			if newRetLines[0][0] == '[' {
				nestedReturnedLines = append(nestedReturnedLines, newRetLines...)
			} else {
				scalarReturnedLines = append(scalarReturnedLines, newRetLines...)
			}
		}
		if len(scalarReturnedLines) == 0 && len(nestedReturnedLines) == 0 {
			return nil, nil
		}
		retLines := []string{fmt.Sprintf("[%s]", strings.Join(pathParts, "\\"))}
		retLines = append(retLines, scalarReturnedLines...)
		retLines = append(retLines, nestedReturnedLines...)
		return retLines, nil
	case reflect.Ptr:
		return convertToRegFormat(pathParts, typedValue.Elem(), actualValue, jsonTag)
	case reflect.Slice, reflect.Array:
		// Currently, all arrays in the options are arrays of strings
		numValues := typedValue.Len()
		arrayValues := make([]string, numValues)
		for i := 0; i < numValues; i++ {
			arrayValues[i] = typedValue.Index(i).String()
		}
		return []string{fmt.Sprintf(`"%s"=hex(7):%s`, jsonTag, stringToMultiStringHexBytes(arrayValues))}, nil
	case reflect.Map:
		// If it's a map (always of string => bool|string|int), the typed and actual values are the same
		// The only difference is that if the field isn't specified in the input, there will be an instance
		// in `typedValue` but not `actualValue`.
		returnedLines := []string{fmt.Sprintf("[%s]", strings.Join(pathParts, "\\"))}
		typedKeys := utils.SortKeys(actualValue.MapKeys())
		for _, typedKey := range typedKeys {
			keyAsString := typedKey.StringKey
			innerLines, err := convertToRegFormat(append(pathParts, keyAsString), actualValue.MapIndex(typedKey.MapKey), typedValue.MapIndex(typedKey.MapKey), keyAsString)
			if err != nil {
				return nil, err
			} else if len(innerLines) > 0 {
				returnedLines = append(returnedLines, innerLines...)
			}
		}
		return returnedLines, nil
	case reflect.Interface:
		// Should be no more typed-value interfaces
		return convertToRegFormat(pathParts, typedValue.Elem(), actualValue, jsonTag)
	case reflect.Bool:
		boolValue := map[bool]int{true: 1, false: 0}[typedValue.Bool()]
		return []string{fmt.Sprintf(`"%s"=dword:%d`, jsonTag, boolValue)}, nil
	case reflect.Int, reflect.Int8, reflect.Int16,
		reflect.Int32, reflect.Uint, reflect.Uint8, reflect.Uint16,
		reflect.Uint32:
		return []string{fmt.Sprintf(`"%s"=dword:%x`, jsonTag, typedValue.Int())}, nil
	case reflect.Int64, reflect.Uint64:
		return []string{fmt.Sprintf(`"%s"=qword:%x`, jsonTag, typedValue.Int())}, nil
	case reflect.Float32, reflect.Float64:
		return []string{fmt.Sprintf(`"%s"=dword:%x`, jsonTag, int(typedValue.Float()))}, nil
	case reflect.String:
		return []string{fmt.Sprintf(`"%s"="%s"`, jsonTag, escape(typedValue.String()))}, nil
	}
	return nil, fmt.Errorf("convertToRegFormat: don't know how to process kind: %q, (%T), value: %v for var %q\n", kind, typedValue, typedValue, jsonTag)
}

// Encode multi-stringSZ settings in comma-separated ucs2 little-endian bytes
// e.g.=> ["abc", "def"] would be ucs-2-encoded as '61,00,62,00,63,00,00,00,64,00,65,00,66,00,00,00,00,00'
// where a null 16-bit word (so two 00 bytes) separate each pair of words and
// two null 16-bit words ("00 00 00 00") indicate the end of the list
func stringToMultiStringHexBytes(values []string) string {
	valueString := strings.Join(values, "\x00")
	hex := utf16.Encode([]rune(valueString))
	hexChars := make([]string, len(hex)*2)
	for i, h := range hex {
		s := fmt.Sprintf("%04x", h)
		hexChars[2*i] = s[2:4]
		hexChars[2*i+1] = s[0:2]
	}
	if len(hexChars) == 0 {
		return "00,00,00,00"
	}
	return strings.Join(hexChars, ",") + ",00,00,00,00"
}

// JsonToReg - convert the json settings to a reg file
// @param hiveType: "hklm" or "hkcu"
// @param profileType: "defaults" or "locked"
// @param settingsBodyAsJSON - options marshaled as JSON
// @returns: array of strings, intended for writing to a reg file
func JsonToReg(hiveType string, profileType string, settingsBodyAsJSON string) ([]string, error) {
	// See comments on the reason for the two kinds of JSON variables in plist.go:JsonToPlist
	var schemaInfluencedSettingsJSON options.ServerSettingsForJSON
	var actualSettingsJSON map[string]interface{}

	fullHiveType, ok := map[string]string{"hklm": "HKEY_LOCAL_MACHINE", "hkcu": "HKEY_CURRENT_USER"}[hiveType]
	if !ok {
		return nil, fmt.Errorf(`unrecognized hiveType of %q, must be "hklm" or "hkcu"`, hiveType)
	}
	_, ok = map[string]bool{"defaults": true, "locked": true}[profileType]
	if !ok {
		return nil, fmt.Errorf(`unrecognized profileType of %q, must be "defaults" or "locked"`, profileType)
	}
	if err := json.Unmarshal([]byte(settingsBodyAsJSON), &schemaInfluencedSettingsJSON); err != nil {
		return nil, fmt.Errorf("error in json: %s", err)
	}
	if err := json.Unmarshal([]byte(settingsBodyAsJSON), &actualSettingsJSON); err != nil {
		return nil, fmt.Errorf("error in json: %s", err)
	}
	headerLines := []string{"Windows Registry Editor Version 5.00"}
	bodyLines, err := convertToRegFormat([]string{fullHiveType, "SOFTWARE", "Policies", "Rancher Desktop", profileType}, reflect.ValueOf(schemaInfluencedSettingsJSON), reflect.ValueOf(actualSettingsJSON), "")
	if err != nil {
		return nil, err
	}
	if len(bodyLines) > 0 {
		headerLines = append(headerLines, fmt.Sprintf("[%s\\%s\\%s]", fullHiveType, "SOFTWARE", "Policies"))
		headerLines = append(headerLines, fmt.Sprintf("[%s\\%s\\%s\\%s]", fullHiveType, "SOFTWARE", "Policies", "Rancher Desktop"))
	}
	return append(headerLines, bodyLines...), nil
}
