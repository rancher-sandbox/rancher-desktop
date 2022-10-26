//go:build darwin || linux

package factoryreset

func DeleteWindowsData(keepSystemImages bool, appName string) error {
	return nil
}

func GetLockfilePath(_ string) (string, error) {
	return "", nil
}
