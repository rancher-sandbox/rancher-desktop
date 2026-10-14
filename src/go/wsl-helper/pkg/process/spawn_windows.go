// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: SUSE LLC
// SPDX-FileCopyrightText: The Rancher Desktop Authors

package process

import (
	"errors"
	"fmt"
	"os"
	"strings"
	"unsafe"

	"github.com/sirupsen/logrus"
	"golang.org/x/sys/windows"
)

type JOBOBJECT_BASIC_LIMIT_INFORMATION struct {
	PerProcessUserTimeLimit int64
	PerJobUserTimeLimit     int64
	LimitFlags              uint32
	MinimumWorkingSetSize   uintptr
	MaximumWorkingSetSize   uintptr
	ActiveProcessLimit      uint32
	Affinity                uintptr
	PriorityClass           uint32
	SchedulingClass         uint32
}
type IO_COUNTERS struct {
	ReadOperationCount  uint64
	WriteOperationCount uint64
	OtherOperationCount uint64
	ReadTransferCount   uint64
	WriteTransferCount  uint64
	OtherTransferCount  uint64
}
type JOBOBJECT_EXTENDED_LIMIT_INFORMATION struct {
	BasicLimitInformation JOBOBJECT_BASIC_LIMIT_INFORMATION
	IoInfo                IO_COUNTERS
	ProcessMemoryLimit    uintptr
	JobMemoryLimit        uintptr
	PeakProcessMemoryUsed uintptr
	PeakJobMemoryUsed     uintptr
}

const (
	jobName                              = "RancherDesktopJob"
	JobObjectExtendedLimitInformation    = 9
	JOB_OBJECT_LIMIT_BREAKAWAY_OK        = uint32(0x00000800)
	JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE   = uint32(0x00002000)
	JOB_OBJECT_LIMIT_SILENT_BREAKAWAY_OK = uint32(0x00001000)
	PROC_THREAD_ATTRIBUTE_JOB_LIST       = 0x0002000D // 13 + input
)

// buildCommandLine convert a slice of arguments into a properly formatted
// command line string suitable for use with [windows.CreateProcess].  This
// function is the reverse of [windows.DecomposeCommandLine], which parses a
// command line string into individual arguments.
//
// The function follows the parsing rules for command-line arguments as outlined in
// https://learn.microsoft.com/en-us/cpp/c-language/parsing-c-command-line-arguments
//
// Key behaviors include:
//
//  1. The first argument (typically the executable name) is treated specially and
//     enclosed in double quotes without applying backslash escape rules,
//     including for embedded quotes.
//
//  2. Each subsequent argument is wrapped in double quotes, and any internal
//     quotes or backslashes are escaped appropriately according to the rules for
//     Windows command-line parsing:
//
//     - Backslashes preceding a quote are doubled (e.g., \ becomes \\), and the
//     quote itself is escaped.
//
//     - Backslashes followed by non-quote characters are preserved as-is.
func buildCommandLine(args []string) string {
	var builder strings.Builder

	// argv[0], i.e. the executable name, must be treated specially.  It is quoted
	// without any of the backslash escape rules.  This includes not being able to
	// escape quotes.
	if len(args) > 0 {
		_, _ = builder.WriteString("\"")
		_, _ = builder.WriteString(args[0])
		_, _ = builder.WriteString("\"")
	}

	for _, word := range args[1:] {
		slashes := 0
		_, _ = builder.WriteString(" \"")
		for _, ch := range []byte(word) {
			switch ch {
			case '\\':
				slashes += 1
			case '"':
				// If a run of backslashes is followed by a quote, each backslash needs
				// to be escaped by another backslash, and then the quote must be
				// itself escaped.
				for i := 0; i < slashes; i++ {
					_, _ = builder.WriteString("\\\\")
				}
				_, _ = builder.WriteString("\\\"")
				slashes = 0
			default:
				// If a run of backslashes is followed by a non-quote character, all of
				// the backslashes are treated literally.
				for i := 0; i < slashes; i++ {
					_, _ = builder.WriteString("\\")
				}
				_ = builder.WriteByte(ch)
				slashes = 0
			}
		}
		// If the word ends in slashes, because we're adding a quote we must escape
		// all of the slashes.
		for i := 0; i < slashes; i++ {
			_, _ = builder.WriteString("\\\\")
		}
		_, _ = builder.WriteString("\"")
	}

	return builder.String()
}

// Given a job handle, spawn a process in the given job.  The function does not
// return until the process exits.
func spawnProcessInJob(job windows.Handle, commandLine *uint16) (*os.ProcessState, error) {
	logrus.Tracef("Spawning in job %x: %s", job, windows.UTF16PtrToString(commandLine))
	// We need the handle to have a stable address for the jobs list; we
	// do this by allocating memory in C to avoid the golang GC moving
	// things around.
	heap, _, err := getProcessHeap.Call()
	if heap == 0 {
		return nil, fmt.Errorf("failed to get process heap: %w", err)
	}

	jobList, _, err := heapAlloc.Call(heap, 0, unsafe.Sizeof(job))
	if jobList == 0 {
		return nil, fmt.Errorf("failed to allocate memory: %w", err)
	}
	defer func() {
		if ok, _, err := heapFree.Call(heap, 0, jobList); ok == 0 {
			logrus.Tracef("Ignoring error %s freeing job list", err)
		}
	}()
	*(*windows.Handle)(unsafe.Pointer(jobList)) = job

	maxAttrCount := uint32(1) // We only have PROC_THREAD_ATTRIBUTE_JOB_LIST
	attrList, err := windows.NewProcThreadAttributeList(maxAttrCount)
	if err != nil {
		return nil, fmt.Errorf("failed to allocate process attributes: %w", err)
	}
	err = attrList.Update(PROC_THREAD_ATTRIBUTE_JOB_LIST, unsafe.Pointer(jobList), unsafe.Sizeof(job))
	if err != nil {
		return nil, fmt.Errorf("failed to update process attributes: %w", err)
	}
	startupInfo := windows.StartupInfoEx{
		StartupInfo: windows.StartupInfo{
			Cb: uint32(unsafe.Sizeof(windows.StartupInfoEx{})),
		},
		ProcThreadAttributeList: attrList.List(),
	}
	var procInfo windows.ProcessInformation
	err = windows.CreateProcess(
		nil, commandLine, nil, nil, true, windows.EXTENDED_STARTUPINFO_PRESENT, nil, nil,
		&startupInfo.StartupInfo, &procInfo)
	if err != nil {
		return nil, fmt.Errorf("failed to create process: %w", err)
	}
	defer func() {
		_ = windows.CloseHandle(procInfo.Process)
		_ = windows.CloseHandle(procInfo.Thread)
	}()
	proc, err := os.FindProcess(int(procInfo.ProcessId))
	if err != nil {
		return nil, fmt.Errorf("failed to find process %d: %w", procInfo.ProcessId, err)
	}
	state, err := proc.Wait()
	if err != nil {
		return nil, err
	}
	return state, nil
}

// configureJobLimits configures the given job to prevent processes in the job
// from breaking away, and flags the job to terminate when the last handle to
// the job is closed.
func configureJobLimits(job windows.Handle) error {
	var limits JOBOBJECT_EXTENDED_LIMIT_INFORMATION
	ok, _, err := queryInformationJobObject.Call(
		uintptr(job),
		JobObjectExtendedLimitInformation,
		uintptr(unsafe.Pointer(&limits)),
		unsafe.Sizeof(limits),
		uintptr(unsafe.Pointer(nil)))
	if ok == 0 {
		return fmt.Errorf("error looking up job limits: %w", err)
	}

	// Prevent processes from breaking away from the job.
	breakAwayFlags := JOB_OBJECT_LIMIT_BREAKAWAY_OK | JOB_OBJECT_LIMIT_SILENT_BREAKAWAY_OK
	limits.BasicLimitInformation.LimitFlags &= ^breakAwayFlags
	// Flag the job to terminate when the last handle to the job is closed.
	limits.BasicLimitInformation.LimitFlags |= JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE

	ok, _, err = setInformationJobObject.Call(
		uintptr(job),
		JobObjectExtendedLimitInformation,
		uintptr(unsafe.Pointer(&limits)),
		unsafe.Sizeof(limits))
	if ok == 0 {
		return fmt.Errorf("error setting job limits: %w", err)
	}

	return nil
}

// injectHandleInProcess creates a copy of the provided handle into the
// specified process.  As nothing refers to the handle otherwise, the duplicated
// handle will only be closed when the specified process exits.
func injectHandleInProcess(pid uint32, handle windows.Handle) error {
	process, err := windows.OpenProcess(windows.PROCESS_DUP_HANDLE, false, pid)
	if err != nil {
		return fmt.Errorf("failed to open parent process %d: %w", pid, err)
	}
	err = windows.DuplicateHandle(windows.CurrentProcess(), handle, process, nil, 0, false, 0)
	if err != nil {
		return fmt.Errorf("failed to inject job into parent process %d: %w", pid, err)
	}
	return nil
}

// Spawn a process in the Rancher Desktop job.  If the job doesn't exist, ensure
// that the given process has a handle to the new job.  Returns the resulting
// process state after the process exits; the caller may get the process exit
// code that way.
func SpawnProcessInRDJob(pid uint32, command []string) (*os.ProcessState, error) {
	jobNameBytes, err := windows.UTF16PtrFromString(jobName)
	if err != nil {
		return nil, fmt.Errorf("failed to convert job name: %w", err)
	}

	// Creating a job that already exists will return the job, with
	// ERROR_ALREADY_EXISTS as the error.  We can use that to determine if we need
	// to do the initial setup.
	jobUintptr, _, err := createJobObject.Call(
		uintptr(unsafe.Pointer(nil)),
		uintptr(unsafe.Pointer(jobNameBytes)))
	if jobUintptr == 0 {
		return nil, fmt.Errorf("failed to create job: %w", err)
	}
	job := windows.Handle(jobUintptr)
	defer func() {
		_ = windows.CloseHandle(job)
	}()
	// Check whether a new job was created, or an existing one was found.
	if !errors.Is(err, os.ErrExist) {
		// The job was newly created.

		if err := configureJobLimits(job); err != nil {
			return nil, err
		}

		// Duplicate the job into the given process (but leaking it).  This way when
		// the target process exits, it will shut down the job.
		if err := injectHandleInProcess(pid, job); err != nil {
			return nil, err
		}
	}

	commandLine, err := windows.UTF16PtrFromString(buildCommandLine(command))
	if err != nil {
		return nil, fmt.Errorf("failed to build command line: %w", err)
	}
	state, err := spawnProcessInJob(job, commandLine)
	if err != nil {
		return nil, fmt.Errorf("failed to spawn process: %w", err)
	}

	return state, nil
}
