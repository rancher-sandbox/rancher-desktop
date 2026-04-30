/*
Copyright © 2024 SUSE LLC

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

package process

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"unsafe"

	"github.com/sirupsen/logrus"
	"golang.org/x/sys/windows"

	"github.com/rancher-sandbox/rancher-desktop/src/go/rdctl/pkg/directories"
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

var (
	hKernel32 = windows.NewLazySystemDLL("kernel32")

	createJobObject           = hKernel32.NewProc("CreateJobObjectW")
	queryInformationJobObject = hKernel32.NewProc("QueryInformationJobObject")
	setInformationJobObject   = hKernel32.NewProc("SetInformationJobObject")
	getProcessHeap            = hKernel32.NewProc("GetProcessHeap")
	heapAlloc                 = hKernel32.NewProc("HeapAlloc")
	heapFree                  = hKernel32.NewProc("HeapFree")
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

// Iterate over all processes, calling a callback function for each process
// found with the process handle and the path to the executable.  If the
// callback function returns an error, iteration is immediately stopped.
func iterProcesses(callback func(proc windows.Handle, executable string) error) error {
	var pids []uint32
	// Try EnumProcesses until the number of pids returned is less than the
	// buffer size.
	err := directories.InvokeWin32WithBuffer(func(size uint32) error {
		pids = make([]uint32, size)
		var bytesReturned uint32
		err := windows.EnumProcesses(pids, &bytesReturned)
		if err != nil || len(pids) < 1 {
			return fmt.Errorf("failed to enumerate processes: %w", err)
		}
		pidsReturned := uintptr(bytesReturned) / unsafe.Sizeof(pids[0])
		if pidsReturned < uintptr(len(pids)) {
			// Remember to truncate the pids to only the valid set.
			pids = pids[:pidsReturned]
			return nil
		}
		return windows.ERROR_INSUFFICIENT_BUFFER
	})
	if err != nil {
		return fmt.Errorf("could not get process list: %w", err)
	}

	for _, pid := range pids {
		// Do each iteration in a function so defer statements run faster.
		err = (func() error {
			hProc, err := windows.OpenProcess(
				windows.PROCESS_QUERY_LIMITED_INFORMATION|windows.PROCESS_TERMINATE,
				false,
				pid)
			if err != nil {
				logrus.Debugf("Ignoring error opening process %d: %s", pid, err)
				return nil
			}
			defer func() {
				_ = windows.CloseHandle(hProc)
			}()

			var executablePath string
			err = directories.InvokeWin32WithBuffer(func(size uint32) error {
				nameBuf := make([]uint16, size)
				charsWritten := size
				err := windows.QueryFullProcessImageName(hProc, 0, &nameBuf[0], &charsWritten)
				if err != nil {
					logrus.Tracef("failed to get image name for pid %d: %s", pid, err)
					return err
				}
				if charsWritten >= size-1 {
					return windows.ERROR_INSUFFICIENT_BUFFER
				}
				executablePath = windows.UTF16ToString(nameBuf)
				return nil
			})
			if err != nil {
				logrus.Debugf("failed to get process name of pid %d: %s (skipping)", pid, err)
				return nil
			}

			if err := callback(hProc, executablePath); err != nil {
				return err
			}
			return nil
		})()
		if err != nil {
			return err
		}
	}

	return nil
}

// Find some pid running the given executable.  If not found, return 0.
func FindPidOfProcess(executable string) (int, error) {
	targetInfo, err := os.Stat(executable)
	if err != nil {
		return 0, fmt.Errorf("failed to determine %s info: %w", executable, err)
	}

	var mainPid int
	// errFound is a sentinel error so we can break out of the loop early.
	errFound := fmt.Errorf("found Rancher Desktop process")
	err = iterProcesses(func(proc windows.Handle, executable string) error {
		pid, err := windows.GetProcessId(proc)
		if err != nil {
			return fmt.Errorf("failed to get pid of process %s", executable)
		}
		info, err := os.Stat(executable)
		if err != nil {
			// Maybe the executable has been deleted since.
			logrus.Debugf("failed to look up executable for pid %d: %s", pid, err)
			return nil
		}
		if os.SameFile(targetInfo, info) {
			mainPid = int(pid)
			return errFound
		}
		return nil
	})
	if err != nil && !errors.Is(err, errFound) {
		return 0, err
	}
	return mainPid, nil
}

// Kill the process group the given process belongs to.  If wait is set, block
// until the target process exits first before doing so.  On Linux, the process
// group is only killed if the given pid is its own process group leader.
func KillProcessGroup(pid int, wait bool) error {
	return errors.New("KillProcessGroup is not implemented on Windows")
}

// TerminateProcessInDirectory terminates all processes where the executable
// resides within the given directory, as gracefully as possible.  The force
// parameter is unused on Windows.
func TerminateProcessInDirectory(directory string, force bool) error {
	return iterProcesses(func(proc windows.Handle, executablePath string) error {
		pid, err := windows.GetProcessId(proc)
		if err != nil {
			pid = 0
		}
		if pid == uint32(os.Getpid()) {
			// Skip terminating the current process.
			return nil
		}
		relPath, err := filepath.Rel(directory, executablePath)
		if err != nil {
			// This may be because they're on different drives, network shares, etc.
			logrus.Tracef("failed to make pid %d image %s relative to %s: %s", pid, executablePath, directory, err)
			return nil
		}
		if strings.HasPrefix(relPath, "..") {
			// Relative path includes "../" prefix, not a child of given directory.
			logrus.Tracef("skipping pid %d (%s), not in %s", pid, executablePath, directory)
			return nil
		}

		logrus.Tracef("will terminate pid %d image %s", pid, executablePath)
		if err = windows.TerminateProcess(proc, 0); err != nil {
			logrus.Errorf("failed to terminate pid %d (%s): %s", pid, executablePath, err)
		}
		return nil
	})
}
