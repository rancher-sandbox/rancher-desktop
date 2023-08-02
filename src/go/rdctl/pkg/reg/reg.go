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
// v: the reflected value of the current field
// jsonTag: the name of the field, used in json (and the registry)
//
// Returns two values:
//
//	an array of lines representing the current value
//	an error: the only non-nil error this function can return is when it encounters an unhandled value type
func convertToRegFormat(pathParts []string, v reflect.Value, jsonTag string) ([]string, error) {
	kind := v.Kind()
	switch kind {
	case reflect.Struct:
		numFields := v.NumField()
		scalarReturnedLines := make([]string, 0, numFields)
		nestedReturnedLines := make([]string, 0)
		for i := 0; i < numFields; i++ {
			fieldTag := v.Type().Field(i).Tag.Get("json")
			fieldName := strings.Replace(fieldTag, ",omitempty", "", 1)
			newRetLines, err := convertToRegFormat(append(pathParts, fieldName), v.Field(i), fieldName)
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
		if v.IsNil() {
			return nil, nil
		} else {
			return convertToRegFormat(pathParts, v.Elem(), jsonTag)
		}
	case reflect.Slice, reflect.Array:
		// Currently, all arrays in the options are arrays of strings
		numValues := v.Len()
		if numValues == 0 {
			return nil, nil
		}
		arrayValues := make([]string, numValues)
		for i := 0; i < numValues; i++ {
			arrayValues[i] = v.Index(i).String()
		}
		return []string{fmt.Sprintf(`"%s"=hex(7):%s`, jsonTag, stringToMultiStringHexBytes(arrayValues))}, nil
	case reflect.Map:
		numValues := len(v.MapKeys())
		if numValues == 0 {
			return nil, nil
		}
		returnedLines := []string{fmt.Sprintf("[%s]", strings.Join(pathParts, "\\"))}
		typedKeys := utils.SortKeys(v.MapKeys())
		for _, typedKey := range typedKeys {
			keyAsString := typedKey.StringKey
			innerLines, err := convertToRegFormat(append(pathParts, keyAsString), v.MapIndex(typedKey.MapKey), keyAsString)
			if err != nil {
				return nil, err
			} else if len(innerLines) > 0 {
				returnedLines = append(returnedLines, innerLines...)
			}
		}
		return returnedLines, nil
	case reflect.Interface:
		if v.IsNil() {
			return nil, nil
		}
		return convertToRegFormat(pathParts, v.Elem(), jsonTag)
	case reflect.Bool:
		boolValue := map[bool]int{true: 1, false: 0}[v.Bool()]
		return []string{fmt.Sprintf(`"%s"=dword:%d`, jsonTag, boolValue)}, nil
	case reflect.Int, reflect.Int8, reflect.Int16,
		reflect.Int32, reflect.Uint, reflect.Uint8, reflect.Uint16,
		reflect.Uint32:
		return []string{fmt.Sprintf(`"%s"=dword:%x`, jsonTag, v.Int())}, nil
	case reflect.Int64, reflect.Uint64:
		return []string{fmt.Sprintf(`"%s"=qword:%x`, jsonTag, v.Int())}, nil
	case reflect.Float32, reflect.Float64:
		return []string{fmt.Sprintf(`"%s"=dword:%x`, jsonTag, int(v.Float()))}, nil
	case reflect.String:
		return []string{fmt.Sprintf(`"%s"="%s"`, jsonTag, escape(v.String()))}, nil
	}
	return nil, fmt.Errorf("convertToRegFormat: don't know how to process kind: %s, (%T), value: %v for var %s\n", kind, v, v, jsonTag)
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
	return strings.Join(hexChars, ",") + ",00,00,00,00"
}

// JsonToReg - convert the json settings to a reg file
// @param hiveType: "hklm" or "hkcu"
// @param profileType: "defaults" or "locked"
// @param settings - options marshaled as JSON
// @returns: array of strings, intended for writing to a reg file

func JsonToReg(hiveType string, profileType string, settingsBodyAsJSON string) ([]string, error) {
	var settings options.ServerSettingsForJSON

	fullHiveType, ok := map[string]string{"hklm": "HKEY_LOCAL_MACHINE", "hkcu": "HKEY_CURRENT_USER"}[hiveType]
	if !ok {
		return nil, fmt.Errorf("unrecognized hiveType of '%s', must be 'hklm' or 'hkcu'", hiveType)
	}
	_, ok = map[string]bool{"defaults": true, "locked": true}[profileType]
	if !ok {
		return nil, fmt.Errorf("unrecognized profileType of '%s', must be 'defaults' or 'locked'", profileType)
	}
	if err := json.Unmarshal([]byte(settingsBodyAsJSON), &settings); err != nil {
		return nil, fmt.Errorf("error in json: %s\n", err)
	}
	headerLines := []string{"Windows Registry Editor Version 5.00"}
	bodyLines, err := convertToRegFormat([]string{fullHiveType, "SOFTWARE", "Policies", "Rancher Desktop", profileType}, reflect.ValueOf(settings), "")
	if err != nil {
		return nil, err
	}
	if len(bodyLines) > 0 {
		headerLines = append(headerLines, fmt.Sprintf("[%s\\%s\\%s]", fullHiveType, "SOFTWARE", "Policies"))
		headerLines = append(headerLines, fmt.Sprintf("[%s\\%s\\%s\\%s]", fullHiveType, "SOFTWARE", "Policies", "Rancher Desktop"))
	}
	return append(headerLines, bodyLines...), nil
}
