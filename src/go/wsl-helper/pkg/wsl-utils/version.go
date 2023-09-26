//go:build windows
// +build windows

package wslutils

import (
	"context"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"unsafe"

	"github.com/sirupsen/logrus"
	"golang.org/x/sys/windows"
)

// WSLInfo describes the current (online) WSL installation.
type WSLInfo struct {
	Installed bool           `json:"installed"`  // Whether WSL is considered to be installed.
	Inbox     bool           `json:"inbox"`      // Whether WSL was shipped in-box or from the MS Store/MSIX
	HasKernel bool           `json:"has_kernel"` // Whether WSL has a kernel installed
	Version   PackageVersion `json:"version"`    // Installed WSL version (only for store version)
}

const (
	kPackageFamily            = "MicrosoftCorporationII.WindowsSubsystemForLinux_8wekyb3d8bbwe" // spellcheck-ignore-line
	kMsiUpgradeCode           = "{1C3DB5B6-65A5-4EBC-A5B9-2F2D6F665F48}"
	PACKAGE_INFORMATION_BASIC = 0x00000000
	PACKAGE_INFORMATION_FULL  = 0x00000100
)

var (
	dllKernel32                = windows.NewLazySystemDLL("kernel32.dll")
	getPackagesByPackageFamily = dllKernel32.NewProc("GetPackagesByPackageFamily")
	openPackageInfoByFullName  = dllKernel32.NewProc("OpenPackageInfoByFullName")
	closePackageInfo           = dllKernel32.NewProc("ClosePackageInfo")
	getPackageInfo             = dllKernel32.NewProc("GetPackageInfo")

	dllMsi                 = windows.NewLazySystemDLL("msi.dll")
	msiEnumRelatedProducts = dllMsi.NewProc("MsiEnumRelatedProductsW")

	// kWSLExeOverride is a context key to override how we run wsl.exe for
	// testing.
	kWSLExeOverride = &struct{}{}
	// kUpgradeCodeOverride is a context key to override the MSI file to look for.
	kUpgradeCodeOverride = &struct{}{}
)

// getPackageNames returns the package names for the given package family.
func getPackageNames(packageFamily string) ([]string, error) {
	var count, bufferLength uint32
	packageFamilyBytes, err := windows.UTF16PtrFromString(packageFamily)
	if err != nil {
		return nil, fmt.Errorf("error allocating package family name: %w", err)
	}
	rv, _, err := getPackagesByPackageFamily.Call(
		uintptr(unsafe.Pointer(packageFamilyBytes)),
		uintptr(unsafe.Pointer(&count)),
		uintptr(unsafe.Pointer(nil)),
		uintptr(unsafe.Pointer(&bufferLength)),
		uintptr(unsafe.Pointer(nil)),
	)
	switch rv {
	case uintptr(windows.ERROR_SUCCESS):
		break
	case uintptr(windows.ERROR_INSUFFICIENT_BUFFER):
		// This is expected: we didn't provide any buffer
		break
	default:
		return nil, fmt.Errorf("error getting buffer size: %w: %w", windows.Errno(rv), err)
	}

	packageNames := make([]uintptr, count)
	packageNameBuffer := make([]uint16, bufferLength)

	rv, _, err = getPackagesByPackageFamily.Call(
		uintptr(unsafe.Pointer(packageFamilyBytes)),
		uintptr(unsafe.Pointer(&count)),
		uintptr(unsafe.Pointer(unsafe.SliceData(packageNames))),
		uintptr(unsafe.Pointer(&bufferLength)),
		uintptr(unsafe.Pointer(unsafe.SliceData(packageNameBuffer))),
	)
	if rv != uintptr(windows.ERROR_SUCCESS) {
		return nil, fmt.Errorf("error getting package names: %w: %w", windows.Errno(rv), err)
	}

	result := make([]string, 0, count)
	slice := unsafe.Slice((**uint16)(unsafe.Pointer(unsafe.SliceData(packageNames))), count)
	for _, ptr := range slice {
		result = append(result, windows.UTF16PtrToString(ptr))
	}

	return result, nil
}

// PackageVersion corresponds to the PACKAGE_VERSION structure.
type PackageVersion struct {
	Revision uint16 `json:"revision"`
	Build    uint16 `json:"build"`
	Minor    uint16 `json:"minor"`
	Major    uint16 `json:"major"`
}

func (v PackageVersion) String() string {
	return fmt.Sprintf("%d.%d.%d.%d", v.Major, v.Minor, v.Build, v.Revision)
}

// packageInfo corresponds to the PACKAGE_INFO structure.
type packageInfo struct {
	reserved          uint32
	flags             uint32
	path              *uint16
	packageFullName   *uint16
	packageFamilyName *uint16
	packageId         struct {
		reserved              uint32
		processorArchitecture uint32
		version               PackageVersion
		name                  *uint16
		publisher             *uint16
		resourceId            *uint16
		publisherId           *uint16
	}
}

// getPackageVersion gets the package version of the package with the given
// full name.
func getPackageVersion(fullName string) (*PackageVersion, error) {
	nameBuffer, err := windows.UTF16PtrFromString(fullName)
	if err != nil {
		return nil, err
	}
	var packageInfoReference uintptr
	rv, _, err := openPackageInfoByFullName.Call(
		uintptr(unsafe.Pointer(nameBuffer)),
		0, // reserved
		uintptr(unsafe.Pointer(&packageInfoReference)),
	)
	if rv != uintptr(windows.ERROR_SUCCESS) {
		return nil, fmt.Errorf("error opening package info: %w: %w", windows.Errno(rv), err)
	}
	defer closePackageInfo.Call(packageInfoReference)

	var bufferLength, count uint32
	rv, _, err = getPackageInfo.Call(
		packageInfoReference,
		uintptr(PACKAGE_INFORMATION_BASIC),
		uintptr(unsafe.Pointer(&bufferLength)),
		uintptr(unsafe.Pointer(nil)),
		uintptr(unsafe.Pointer(nil)),
	)
	switch rv {
	case uintptr(windows.ERROR_SUCCESS):
		break
	case uintptr(windows.ERROR_INSUFFICIENT_BUFFER):
		// This is expected: we didn't provide any buffer
		break
	default:
		return nil, fmt.Errorf("error getting buffer size: %w: %w", windows.Errno(rv), err)
	}

	buf := make([]byte, bufferLength)
	rv, _, err = getPackageInfo.Call(
		packageInfoReference,
		uintptr(PACKAGE_INFORMATION_BASIC),
		uintptr(unsafe.Pointer(&bufferLength)),
		uintptr(unsafe.Pointer(unsafe.SliceData(buf))),
		uintptr(unsafe.Pointer(&count)),
	)
	if rv != uintptr(windows.ERROR_SUCCESS) {
		return nil, fmt.Errorf("error getting package info: %w: %w", windows.Errno(rv), err)
	}
	infos := unsafe.Slice((*packageInfo)(unsafe.Pointer(unsafe.SliceData(buf))), count)
	for _, info := range infos {
		// `info` is a pointer to an unsafe slice; make a copy of the version
		// on the stack and then return that so the GC knows about it.
		versionCopy := info.packageId.version
		return &versionCopy, nil
	}

	return nil, fmt.Errorf("no info found for %s", fullName)
}

// runWSLExe runs WSL.exe and returns the standard output.
// This can be replaced for testing.
func runWSLExe(ctx context.Context, args ...string) (string, error) {
	systemDir, err := windows.GetSystemDirectory()
	if err != nil {
		return "", fmt.Errorf("failed to get system directory: %w", err)
	}
	wslPath := filepath.Join(systemDir, "wsl.exe")
	cmd := exec.CommandContext(ctx, wslPath, "--status")
	cmd.Stderr = os.Stderr
	stdout, err := cmd.Output()
	if err != nil {
		return "", fmt.Errorf("failed to get WSL status: %w", err)
	}
	output := windows.UTF16PtrToString(
		(*uint16)(unsafe.Pointer(unsafe.SliceData(append(stdout, 0, 0)))),
	)
	return output, nil
}

// isInboxWSLInstalled checks if the "in-box" version of WSL is installed,
// returning whether it's installed, and whether the kernel is installed
func isInboxWSLInstalled(ctx context.Context) (bool, bool, error) {
	runWSLExeFunc := runWSLExe
	if f := ctx.Value(&kWSLExeOverride); f != nil {
		runWSLExeFunc = f.(func(context.Context, ...string) (string, error))
	}

	output, err := runWSLExeFunc(ctx, "--status")
	var exitErr *exec.ExitError
	if errors.As(err, &exitErr) && exitErr.ExitCode() == 50 {
		// When WSL is not installed, we seem to get exit code 50
		return false, false, nil
	} else if err != nil {
		logrus.WithError(err).Trace("wsl.exe --status exited")
		return false, false, err
	}
	lines := strings.Split(strings.TrimSpace(output), "\n")
	if len(lines) < 1 {
		return false, false, fmt.Errorf("no output from wsl --status")
	}

	// Check if the kernel is installed.
	upgradeCodeString := kMsiUpgradeCode
	if v := ctx.Value(&kUpgradeCodeOverride); v != nil {
		upgradeCodeString = v.(string)
	}
	upgradeCode, err := windows.UTF16PtrFromString(upgradeCodeString)
	if err != nil {
		return false, false, err
	}
	productCode := make([]uint16, 39)

	rv, _, _ := msiEnumRelatedProducts.Call(
		uintptr(unsafe.Pointer(upgradeCode)),
		uintptr(0),
		uintptr(0),
		uintptr(unsafe.Pointer(unsafe.SliceData(productCode))),
	)
	switch rv {
	case uintptr(windows.ERROR_SUCCESS):
		return true, true, nil
	case uintptr(windows.ERROR_NO_MORE_ITEMS):
		return true, false, nil
	default:
		err = windows.Errno(rv)
		err = fmt.Errorf("error querying Windows Installer database: %w", err)
		return false, false, err
	}
}

func GetWSLInfo(ctx context.Context) (*WSLInfo, error) {
	names, err := getPackageNames(kPackageFamily)
	if err != nil {
		logrus.WithError(err).Trace("Error getting appx packages")
		return nil, err
	}

	logrus.Tracef("Got %d appx packages", len(names))
	for _, name := range names {
		if version, err := getPackageVersion(name); err == nil {
			// It seems like the store version _always_ has the kernel,
			// somewhere; it doesn't seem possible to uninstall it.
			logrus.Tracef("Got appx package %s with version %s", name, version)
			return &WSLInfo{
				Installed: true,
				Inbox:     false,
				HasKernel: true,
				Version:   *version,
			}, nil
		}
	}

	logrus.Trace("Failed to get WSL appx package, trying inbox versions...")
	hasWSL, hasKernel, err := isInboxWSLInstalled(ctx)
	if err != nil {
		return nil, err
	}
	return &WSLInfo{
		Installed: hasWSL,
		Inbox:     hasWSL,
		HasKernel: hasKernel,
	}, nil
}
