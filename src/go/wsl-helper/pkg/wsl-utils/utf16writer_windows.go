package wslutils

import (
	"io"
	"unicode/utf16"
	"unsafe"
)

// utf16Writer is a writer that attempts to convert writes in UTF-16 to UTF-8.
type utf16Writer struct {
	io.Writer
}

func (w *utf16Writer) Write(p []byte) (int, error) {
	// Manually decode the data; don't use windows.UTF16PtrToString because we
	// don't assume the input is zero-terminated (but we have a valid length).
	runes := utf16.Decode(unsafe.Slice((*uint16)(unsafe.Pointer(unsafe.SliceData(p))), len(p)/2))
	str := string(runes)
	_, err := w.Writer.Write(unsafe.Slice(unsafe.StringData(str), len(str)))
	// Even though we may not have written all of the bytes, report that we
	// consumed it all; this beats figuring out how many bytes we have _actually_
	// written.  To do this correctly, we'd need to decode the runes one at a time
	// and feed it to the writer without buffering, but that seems terrible.
	return len(p), err
}
