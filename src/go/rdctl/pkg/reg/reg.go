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
	"reflect"
	"strings"
	"unicode/utf16"

	options "github.com/rancher-sandbox/rancher-desktop/src/go/rdctl/pkg/options/generated"
	"github.com/rancher-sandbox/rancher-desktop/src/go/rdctl/pkg/utils"
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
// structType: type information on the current field for the `value` parameter
// value: the reflected value of the current field, based on a simple map[string]interface{} JSON-parse
// jsonTag: the name of the field, used in json (and the registry)
// path: a dotted representation of the fully-qualified name of the field
//
// Returns two values:
//
//	an array of lines representing the current value
//	an error: the only non-nil error this function can return is when it encounters an unhandled value type
func convertToRegFormat(pathParts []string, structType reflect.Type, value reflect.Value, jsonTag, path string) ([]string, error) {
	kind := structType.Kind()
	if value.Kind() == reflect.Interface && kind != reflect.Interface {
		if value.IsNil() {
			return nil, nil
		}
		return convertToRegFormat(pathParts, structType, value.Elem(), jsonTag, path)
	}
	if value.Kind() == reflect.Ptr {
		return nil, fmt.Errorf("reg-file generation: got an unexpected pointer for %s value %v, expecting type %v", path, value, structType)
	}
	switch kind {
	case reflect.Struct:
		// Processing here is similar to struct fields in plist.go
		// In the plist world we want to order the fields according to their
		// position in the defined ServerSettingsForJSON struct.
		// In the registry world the fields are ordered alphabetically ignoring case.
		//
		if value.Kind() != reflect.Map {
			return nil, fmt.Errorf("expecting actual kind for a typed struct to be a map, got %v", value.Kind())
		}
		numTypedFields := structType.NumField()
		sortedStructFields := utils.SortStructFields(structType)
		scalarReturnedLines := make([]string, 0, numTypedFields)
		nestedReturnedLines := make([]string, 0)
		for i := range sortedStructFields {
			compoundStructField := &sortedStructFields[i]
			fieldName := compoundStructField.FieldName
			valueElement := value.MapIndex(reflect.ValueOf(fieldName))
			if valueElement.IsValid() {
				newRetLines, err := convertToRegFormat(append(pathParts, fieldName),
					compoundStructField.StructField.Type,
					valueElement,
					fieldName,
					path+"."+fieldName)
				if err != nil {
					return nil, err
				}
				if len(newRetLines) == 0 {
					continue
				}
				// If the first character of the first line is a '[' it's a struct. Otherwise, it's a scalar.
				// ']' placed here to appease my IDE's linter.
				if newRetLines[0][0] == '[' {
					nestedReturnedLines = append(nestedReturnedLines, newRetLines...)
				} else {
					scalarReturnedLines = append(scalarReturnedLines, newRetLines...)
				}
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
		return convertToRegFormat(pathParts, structType.Elem(), value, jsonTag, path)
	case reflect.Slice, reflect.Array:
		if value.Kind() != reflect.Slice && value.Kind() != reflect.Array {
			return nil, fmt.Errorf("expected slice or array at %s, got %v", path, value.Kind())
		}
		// Currently, all arrays in the options are arrays of strings
		numValues := value.Len()
		arrayValues := make([]string, numValues)
		for i := 0; i < numValues; i++ {
			item := value.Index(i)
			for item.Kind() == reflect.Interface || item.Kind() == reflect.Pointer {
				item = item.Elem()
			}
			arrayValues[i] = item.String()
		}
		return []string{fmt.Sprintf(`"%s"=hex(7):%s`, jsonTag, stringToMultiStringHexBytes(arrayValues))}, nil
	case reflect.Map:
		returnedLines := []string{fmt.Sprintf("[%s]", strings.Join(pathParts, "\\"))}
		mapKeys := utils.SortKeys(value.MapKeys())
		for _, mapKey := range mapKeys {
			keyAsString := mapKey.StringKey
			innerLines, err := convertToRegFormat(append(pathParts, keyAsString), structType.Elem(), value.MapIndex(mapKey.MapKey), keyAsString, path+"."+keyAsString)
			if err != nil {
				return nil, err
			} else if len(innerLines) > 0 {
				returnedLines = append(returnedLines, innerLines...)
			}
		}
		return returnedLines, nil
	case reflect.Interface:
		// Since we allow whatever here, just use the actual type of the value.
		// But if it's an interface{} we'll need to dereference it first to avoid
		// an infinite loop.
		for value.Kind() == reflect.Interface {
			value = value.Elem()
		}
		return convertToRegFormat(pathParts, value.Type(), value, jsonTag, path)
	case reflect.Bool:
		boolValue := map[bool]int{true: 1, false: 0}[value.Bool()]
		return []string{fmt.Sprintf(`"%s"=dword:%d`, jsonTag, boolValue)}, nil
	case reflect.Int, reflect.Int8, reflect.Int16,
		reflect.Int32, reflect.Uint, reflect.Uint8, reflect.Uint16,
		reflect.Uint32:
		if value.CanConvert(reflect.TypeOf(int64(0))) {
			value = value.Convert(reflect.TypeOf(int64(0)))
		}
		return []string{fmt.Sprintf(`"%s"=dword:%x`, jsonTag, value.Int())}, nil
	case reflect.Int64, reflect.Uint64:
		if value.CanConvert(reflect.TypeOf(int64(0))) {
			value = value.Convert(reflect.TypeOf(int64(0)))
		}
		return []string{fmt.Sprintf(`"%s"=qword:%x`, jsonTag, value.Int())}, nil
	case reflect.Float32, reflect.Float64:
		return []string{fmt.Sprintf(`"%s"=dword:%x`, jsonTag, int(value.Float()))}, nil
	case reflect.String:
		return []string{fmt.Sprintf(`"%s"="%s"`, jsonTag, escape(value.String()))}, nil
	}
	return nil, fmt.Errorf("convertToRegFormat: don't know how to process %s kind: %q, (%T), value: %v for var %q", path, kind, structType, value, jsonTag)
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
		return "00,00"
	}
	return strings.Join(hexChars, ",") + ",00,00,00,00"
}

// JSONToReg - convert the json settings to a reg file
// @param hiveType: "hklm" or "hkcu"
// @param profileType: "defaults" or "locked"
// @param settingsBodyAsJSON - options marshaled as JSON
// @returns: array of strings, intended for writing to a reg file
func JSONToReg(hiveType, profileType, settingsBodyAsJSON string) ([]string, error) {
	var actualSettingsJSON map[string]interface{}

	fullHiveType, ok := map[string]string{"hklm": "HKEY_LOCAL_MACHINE", "hkcu": "HKEY_CURRENT_USER"}[hiveType]
	if !ok {
		return nil, fmt.Errorf(`unrecognized hiveType of %q, must be "hklm" or "hkcu"`, hiveType)
	}
	_, ok = map[string]bool{"defaults": true, "locked": true}[profileType]
	if !ok {
		return nil, fmt.Errorf(`unrecognized profileType of %q, must be "defaults" or "locked"`, profileType)
	}
	if err := json.Unmarshal([]byte(settingsBodyAsJSON), &actualSettingsJSON); err != nil {
		return nil, fmt.Errorf("error in json: %s", err)
	}
	_, ok = actualSettingsJSON["version"]
	if !ok {
		actualSettingsJSON["version"] = options.CURRENT_SETTINGS_VERSION
	}
	headerLines := []string{"Windows Registry Editor Version 5.00"}
	bodyLines, err := convertToRegFormat([]string{fullHiveType, "SOFTWARE", "Policies", "Rancher Desktop", profileType}, reflect.TypeOf(options.ServerSettingsForJSON{}), reflect.ValueOf(actualSettingsJSON), "", "")
	if err != nil {
		return nil, err
	}
	if len(bodyLines) > 0 {
		headerLines = append(
			headerLines,
			fmt.Sprintf("[%s\\%s\\%s]", fullHiveType, "SOFTWARE", "Policies"),
			fmt.Sprintf("[%s\\%s\\%s\\%s]", fullHiveType, "SOFTWARE", "Policies", "Rancher Desktop"))
	}
	return append(headerLines, bodyLines...), nil
}
