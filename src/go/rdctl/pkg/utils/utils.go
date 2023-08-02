package utils

import (
	"path/filepath"
	"reflect"
	"sort"
)

// Get the steps-th parent directory of fullPath.
func GetParentDir(fullPath string, steps int) string {
	fullPath = filepath.Clean(fullPath)
	for ; steps > 0; steps-- {
		fullPath = filepath.Dir(fullPath)
	}
	return fullPath
}

type mapKeyWithString struct {
	MapKey    reflect.Value
	StringKey string
}

func SortKeys(mapKeys []reflect.Value) []mapKeyWithString {
	retVals := make([]mapKeyWithString, len(mapKeys))
	for idx, key := range mapKeys {
		mapKeyAsString := key.String()
		retVals[idx] = mapKeyWithString{key, mapKeyAsString}
	}
	sort.Slice(retVals, func(i, j int) bool {
		return retVals[i].StringKey < retVals[j].StringKey
	})
	return retVals
}
