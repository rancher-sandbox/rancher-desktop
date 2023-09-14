package utils

import (
	"path/filepath"
	"reflect"
	"sort"
	"strings"
)

func FindTypedFieldIndex(fieldName string, v reflect.Value, numTypedFields int) int {
	for i := 0; i < numTypedFields; i++ {
		typedFieldTag := v.Type().Field(i).Tag.Get("json")
		typedFieldName := strings.Replace(typedFieldTag, ",omitempty", "", 1)
		if typedFieldName == fieldName {
			return i
		}
	}
	return -1
}

// Get the steps-th parent directory of fullPath.
func GetParentDir(fullPath string, steps int) string {
	fullPath = filepath.Clean(fullPath)
	for ; steps > 0; steps-- {
		fullPath = filepath.Dir(fullPath)
	}
	return fullPath
}

type mapKeyWithString struct {
	MapKey       reflect.Value
	StringKey    string
	lowerCaseKey string // only for sorting
}

func SortKeys(mapKeys []reflect.Value) []mapKeyWithString {
	retVals := make([]mapKeyWithString, len(mapKeys))
	for idx, key := range mapKeys {
		mapKeyAsString := key.String()
		retVals[idx] = mapKeyWithString{key, mapKeyAsString, strings.ToLower(mapKeyAsString)}
	}
	sort.Slice(retVals, func(i, j int) bool {
		return retVals[i].lowerCaseKey < retVals[j].lowerCaseKey
	})
	return retVals
}

type structFieldWithString struct {
	StructField  reflect.StructField
	FieldName    string
	lowerCaseKey string // only for sorting
}

func SortStructFields(structType reflect.Type) []structFieldWithString {
	numTypedFields := structType.NumField()
	newInterimFields := make([]structFieldWithString, numTypedFields)
	for i := 0; i < numTypedFields; i++ {
		fieldTag := structType.Field(i).Tag.Get("json")
		fieldName, _, _ := strings.Cut(fieldTag, ",")
		newInterimFields[i] = structFieldWithString{structType.Field(i), fieldName, strings.ToLower(fieldName)}
	}
	sort.Slice(newInterimFields, func(i, j int) bool {
		return newInterimFields[i].lowerCaseKey < newInterimFields[j].lowerCaseKey
	})
	return newInterimFields
}
