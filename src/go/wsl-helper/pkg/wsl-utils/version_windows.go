/*
Copyright © 2023 SUSE LLC

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

	http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
*/

package wslutils

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"regexp"
	"strconv"
	"strings"
	"unsafe"

	"github.com/sirupsen/logrus"
	"golang.org/x/sys/windows"
)

// WSLInfo describes the current (online) WSL installation.
type WSLInfo struct {
	Installed      bool           `json:"installed"`       // Whether WSL is considered to be installed.
	Inbox          bool           `json:"inbox"`           // Whether WSL was shipped in-box or from the MS Store/MSIX
	Version        PackageVersion `json:"version"`         // Installed WSL version (only for store version)
	KernelVersion  PackageVersion `json:"kernel_version"`  // Installed WSL kernel version
	HasKernel      bool           `json:"has_kernel"`      // Whether WSL has a kernel installed
	OutdatedKernel bool           `json:"outdated_kernel"` // Whether the WSL kernel is too old
}

func (i WSLInfo) String() string {
	var parts []string
	if i.Installed {
		parts = append(parts, "installed")
	}
	if i.Inbox {
		parts = append(parts, "inbox")
	}
	if i.HasKernel {
		parts = append(parts, "has-kernel")
	}
	if i.OutdatedKernel {
		parts = append(parts, "outdated-kernel")
	}
	if len(parts) == 0 {
		parts = append(parts, "not-installed")
	}
	return fmt.Sprintf("Version=%s kernel=%s (%s)", i.Version, i.KernelVersion, strings.Join(parts, ", "))
}

const (
	// kPackageFamily is the package family for the WSL app (MSIX).
	kPackageFamily = "MicrosoftCorporationII.WindowsSubsystemForLinux_8wekyb3d8bbwe" // spellcheck-ignore-line
	// kMsiUpgradeCode is the upgrade code for the WSL kernel (for in-box WSL2)
	kMsiUpgradeCode               = "{1C3DB5B6-65A5-4EBC-A5B9-2F2D6F665F48}"
	INSTALLPROPERTY_VERSIONSTRING = "VersionString"
	PACKAGE_INFORMATION_BASIC     = 0x00000000
	PACKAGE_INFORMATION_FULL      = 0x00000100
	PACKAGE_FILTER_STATIC         = 0x00080000
	PACKAGE_FILTER_DYNAMIC        = 0x00100000
	PackagePathType_Effective     = 2
	// wslExitNotInstalled is the exit code from `wsl --status` when WSL is not
	// installed.
	wslExitNotInstalled = 50
	// wslExitVersion is the expected exit code from `wsl --version`.
	wslExitVersion = 128
)

var (
	dllKernel32                = windows.NewLazySystemDLL("kernel32.dll")
	getPackagesByPackageFamily = dllKernel32.NewProc("GetPackagesByPackageFamily")
	openPackageInfoByFullName  = dllKernel32.NewProc("OpenPackageInfoByFullName")
	closePackageInfo           = dllKernel32.NewProc("ClosePackageInfo")
	getPackageInfo             = dllKernel32.NewProc("GetPackageInfo")

	dllMsi                 = windows.NewLazySystemDLL("msi.dll")
	msiEnumRelatedProducts = dllMsi.NewProc("MsiEnumRelatedProductsW")
	msiGetProductInfo      = dllMsi.NewProc("MsiGetProductInfoW")

	// kWSLExeOverride is a context key to override how we run wsl.exe for
	// testing.
	kWSLExeOverride = &struct{}{}
	// kUpgradeCodeOverride is a context key to override the MSI file to look for.
	kUpgradeCodeOverride = &struct{}{}
	// MinimumKernelVersion is the minimum WSL kernel version required to not be
	// considered outdated.
	MinimumKernelVersion = PackageVersion{Major: 5, Minor: 15}
)

// errorFromWin32 wraps a Win32 return value into an error, with a message in
// the form of: {msg}: {rv}: {error}
func errorFromWin32(msg string, rv uintptr, err error) error {
	if err != nil {
		return fmt.Errorf("%s: %w: %w", msg, windows.Errno(rv), err)
	}
	return fmt.Errorf("%s: %w", msg, windows.Errno(rv))
}

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
		return nil, errorFromWin32("error getting buffer size", rv, err)
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
		return nil, errorFromWin32("error getting package names", rv, err)
	}

	result := make([]string, count)
	slice := unsafe.Slice((**uint16)(unsafe.Pointer(unsafe.SliceData(packageNames))), count)
	for i, ptr := range slice {
		result[i] = windows.UTF16PtrToString(ptr)
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

func (v *PackageVersion) UnmarshalText(text []byte) error {
	expr, err := regexp.Compile(`\s*(\d+)[.,](\d+)[.,](\d+)(?:[.,](\d+))?`)
	if err != nil {
		return err
	}
	groups := expr.FindStringSubmatch(string(text))
	if groups == nil {
		return fmt.Errorf("could not parse version %q", string(text))
	}
	var allErrors []error
	if part, err := strconv.ParseInt(groups[1], 10, 16); err == nil {
		v.Major = uint16(part)
	} else {
		err = fmt.Errorf("version %q has invalid major part: %w", string(text), err)
		allErrors = append(allErrors, err)
	}
	if part, err := strconv.ParseInt(groups[2], 10, 16); err == nil {
		v.Minor = uint16(part)
	} else {
		err = fmt.Errorf("version %q has invalid minor part: %w", string(text), err)
		allErrors = append(allErrors, err)
	}
	if part, err := strconv.ParseInt(groups[3], 10, 16); err == nil {
		v.Build = uint16(part)
	} else {
		err = fmt.Errorf("version %q has invalid build part: %w", string(text), err)
		allErrors = append(allErrors, err)
	}
	if groups[4] != "" {
		if part, err := strconv.ParseInt(groups[4], 10, 16); err == nil {
			v.Revision = uint16(part)
		} else {
			err = fmt.Errorf("version %q has invalid revision part: %w", string(text), err)
			allErrors = append(allErrors, err)
		}
	}
	if len(allErrors) > 0 {
		return errors.Join(allErrors...)
	}
	return nil
}

// Less returns true if this version is lower (i.e. older) than the other.
func (v PackageVersion) Less(other PackageVersion) bool {
	switch {
	case v.Major != other.Major:
		return v.Major < other.Major
	case v.Minor != other.Minor:
		return v.Minor < other.Minor
	case v.Build != other.Build:
		return v.Build < other.Build
	case v.Revision != other.Revision:
		return v.Revision < other.Revision
	}
	return false
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
		return nil, errorFromWin32("error opening package info", rv, err)
	}
	defer closePackageInfo.Call(packageInfoReference)

	var bufferLength, count uint32
	rv, _, err = getPackageInfo.Call(
		packageInfoReference,
		uintptr(PACKAGE_INFORMATION_BASIC|PACKAGE_FILTER_STATIC|PACKAGE_FILTER_DYNAMIC),
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
		return nil, errorFromWin32("error getting buffer size", rv, err)
	}

	buf := make([]byte, bufferLength)
	rv, _, err = getPackageInfo.Call(
		packageInfoReference,
		uintptr(PACKAGE_INFORMATION_BASIC|PACKAGE_FILTER_STATIC|PACKAGE_FILTER_DYNAMIC),
		uintptr(unsafe.Pointer(&bufferLength)),
		uintptr(unsafe.Pointer(unsafe.SliceData(buf))),
		uintptr(unsafe.Pointer(&count)),
	)
	if rv != uintptr(windows.ERROR_SUCCESS) {
		return nil, errorFromWin32("error getting package info", rv, err)
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

// Get the component versions for an AppX-based installation.  Returns the WSL
// version, followed by the kernel version.
func getAppxVersion(ctx context.Context, log *logrus.Entry) (*PackageVersion, *PackageVersion, error) {
	newRunnerFunc := NewWSLRunner
	if f := ctx.Value(&kWSLExeOverride); f != nil {
		newRunnerFunc = f.(func() WSLRunner)
	}
	output := &bytes.Buffer{}
	err := newRunnerFunc().WithStdout(output).WithStderr(os.Stderr).Run(ctx, "--version")
	var exitError *exec.ExitError
	if errors.As(err, &exitError) && exitError.ExitCode() == wslExitVersion {
		// wsl --version is expected to return non-nil
	} else if err != nil {
		return nil, nil, fmt.Errorf("error running wsl --version: %w", err)
	}
	log.WithField("raw", output.String()).Trace("wsl --version output")
	expr, err := regexp.Compile(`\s+\d+[.,]\d+[.,]\d+(?:[.,]\d+)?`)
	if err != nil {
		return nil, nil, fmt.Errorf("failed to compile version regular expression: %w", err)
	}
	var errorList []error
	var version, wslVersion, kernelVersion PackageVersion
	i := 0
	for _, line := range strings.Split(output.String(), "\n") {
		line = strings.TrimSpace(line)
		matchedString := expr.FindString(line)
		if matchedString == "" {
			log.WithField("line", line).Trace("line does not contain version string")
			continue
		}
		log.WithField("line", line).WithField("version", matchedString).Trace("found version string")
		if err = version.UnmarshalText([]byte(matchedString)); err != nil {
			errorList = append(errorList, err)
		} else {
			switch i {
			case 0:
				wslVersion = version
			case 1:
				kernelVersion = version
			}
			i++
			if i > 1 {
				break
			}
		}
	}
	if len(errorList) > 0 {
		return nil, nil, fmt.Errorf("error getting AppX version: %w", errors.Join(errorList...))
	}
	log.WithFields(logrus.Fields{"wsl": wslVersion, "kernel": kernelVersion}).Trace("got AppX version")
	return &wslVersion, &kernelVersion, nil
}

// getInboxWSLInfo checks if the "in-box" version of WSL is installed, returning
// whether it's installed, and the version of the kernel installed (if any)
func getInboxWSLInfo(ctx context.Context, log *logrus.Entry) (bool, *PackageVersion, error) {
	var allErrors []error

	// Check if the core is installed
	coreInstalled := false
	newRunnerFunc := NewWSLRunner
	if f := ctx.Value(&kWSLExeOverride); f != nil {
		newRunnerFunc = f.(func() WSLRunner)
	}
	output := &bytes.Buffer{}
	err := newRunnerFunc().WithStdout(output).WithStderr(os.Stderr).Run(ctx, "--status")
	var exitErr *exec.ExitError
	if errors.As(err, &exitErr) && exitErr.ExitCode() == wslExitNotInstalled {
		// When WSL is not installed, we seem to get exit code 50
	} else if err != nil {
		log.WithError(err).Trace("wsl.exe --status exited")
		allErrors = append(allErrors, err)
	} else {
		lines := strings.Split(strings.TrimSpace(output.String()), "\n")
		if len(lines) > 0 {
			coreInstalled = true
		} else {
			allErrors = append(allErrors, fmt.Errorf("no output from wsl --status"))
		}
	}

	// Check if the kernel is installed.
	var kernelVersion *PackageVersion
	upgradeCodeString := kMsiUpgradeCode
	if v := ctx.Value(&kUpgradeCodeOverride); v != nil {
		upgradeCodeString = v.(string)
	}
	upgradeCode, err := windows.UTF16PtrFromString(upgradeCodeString)
	if err != nil {
		allErrors = append(allErrors, err)
	} else {
		productCode := make([]uint16, 39)

		rv, _, _ := msiEnumRelatedProducts.Call(
			uintptr(unsafe.Pointer(upgradeCode)),
			uintptr(0),
			uintptr(0),
			uintptr(unsafe.Pointer(unsafe.SliceData(productCode))),
		)
		switch rv {
		case uintptr(windows.ERROR_SUCCESS):
			kernelVersion, err = getMSIVersion(productCode, log)
			if err != nil {
				allErrors = append(allErrors, fmt.Errorf("error getting kernel version: %w", err))
			}
		case uintptr(windows.ERROR_NO_MORE_ITEMS):
			// kernel is not installed
		default:
			err = errorFromWin32("error querying Windows Installer database", rv, nil)
			allErrors = append(allErrors, err)
		}
	}

	return coreInstalled, kernelVersion, errors.Join(allErrors...)
}

// Get the version of an installed MSI package, given its product code.
func getMSIVersion(productCode []uint16, log *logrus.Entry) (*PackageVersion, error) {
	version := PackageVersion{}
	versionStringWide, err := windows.UTF16PtrFromString(INSTALLPROPERTY_VERSIONSTRING)
	if err != nil {
		return nil, err
	}

	bufSize := 0
	var wideBuf []uint16
	rv, _, _ := msiGetProductInfo.Call(
		uintptr(unsafe.Pointer(unsafe.SliceData(productCode))),
		uintptr(unsafe.Pointer(versionStringWide)),
		uintptr(unsafe.Pointer(nil)),
		uintptr(unsafe.Pointer(&bufSize)),
	)
	switch rv {
	case uintptr(windows.ERROR_SUCCESS):
		log.WithFields(logrus.Fields{"bufSize": bufSize}).Trace("unexpected success, assuming needs more data")
		fallthrough
	case uintptr(windows.ERROR_MORE_DATA):
		wideBuf = make([]uint16, bufSize+1) // Add space for null terminator
		bufSize = len(wideBuf)
	case uintptr(windows.ERROR_BAD_CONFIGURATION):
		err = errorFromWin32("Windows Installer configuration data is corrupt", rv, nil)
		return nil, err
	default:
		return nil, errorFromWin32("failed to get WSL kernel MSI version", rv, nil)
	}

	rv, _, _ = msiGetProductInfo.Call(
		uintptr(unsafe.Pointer(unsafe.SliceData(productCode))),
		uintptr(unsafe.Pointer(versionStringWide)),
		uintptr(unsafe.Pointer(unsafe.SliceData(wideBuf))),
		uintptr(unsafe.Pointer(&bufSize)),
	)
	switch rv {
	case uintptr(windows.ERROR_SUCCESS):
		versionString := windows.UTF16ToString(wideBuf[:bufSize])
		if err = version.UnmarshalText([]byte(versionString)); err != nil {
			return nil, err
		}
		return &version, nil
	case uintptr(windows.ERROR_MORE_DATA):
		return nil, errorFromWin32("allocated buffer was too small", rv, nil)
	case uintptr(windows.ERROR_BAD_CONFIGURATION):
		err = errorFromWin32("Windows Installer configuration data is corrupt", rv, nil)
		return nil, err
	default:
		return nil, errorFromWin32("failed to get WSL kernel MSI version", rv, nil)
	}
}

func GetWSLInfo(ctx context.Context, log *logrus.Entry) (*WSLInfo, error) {
	names, err := getPackageNames(kPackageFamily)
	if err != nil {
		log.WithError(err).Trace("Error getting appx packages")
		return nil, err
	}

	log.Tracef("Got %d appx packages", len(names))
	for _, name := range names {
		if version, err := getPackageVersion(name); err == nil {
			log.Tracef("Got appx package %s with version %s", name, version)
			wslVersion, kernelVersion, err := getAppxVersion(ctx, log)
			if err != nil {
				return nil, err
			}
			return &WSLInfo{
				Installed:      true,
				Inbox:          false,
				Version:        *wslVersion,
				KernelVersion:  *kernelVersion,
				HasKernel:      PackageVersion{}.Less(*kernelVersion),
				OutdatedKernel: kernelVersion.Less(MinimumKernelVersion),
			}, nil
		} else {
			log.WithError(err).Trace("Failed to get package version")
		}
	}

	log.Trace("Failed to get WSL appx package, trying inbox versions...")
	hasWSL, kernelVersion, err := getInboxWSLInfo(ctx, log)
	if err != nil {
		return nil, err
	}
	if kernelVersion == nil {
		kernelVersion = &PackageVersion{}
	}
	hasKernel := PackageVersion{}.Less(*kernelVersion)
	return &WSLInfo{
		Installed:      hasWSL && hasKernel,
		Inbox:          hasWSL,
		HasKernel:      hasKernel,
		KernelVersion:  *kernelVersion,
		OutdatedKernel: kernelVersion.Less(MinimumKernelVersion),
	}, nil
}
