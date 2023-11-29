package wslutils

import (
	"io"
	"unsafe"

	"golang.org/x/sys/windows"
)

// utf16Writer is a writer that attempts to convert writes in UTF-16 to UTF-8.
type utf16Writer struct {
	io.Writer
}

func (w *utf16Writer) Write(p []byte) (int, error) {
	output := windows.UTF16PtrToString(
		(*uint16)(unsafe.Pointer(unsafe.SliceData(append(p, 0, 0)))),
	)
	n, err := w.Writer.Write(
		unsafe.Slice(unsafe.StringData(output), len(output)),
	)
	return n * 2, err
}
