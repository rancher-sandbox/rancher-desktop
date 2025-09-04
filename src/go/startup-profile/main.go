// Command startup-profile generates a Chrome devtools profile format.
// The output can be loaded via https://profiler.firefox.com/ or via Chrome
// devtools (Performance tab).
package main

import (
	"context"
	"flag"
	"fmt"
	"log"
	"os"
	"path/filepath"
)

// marshalledPath represents a path.  It implements [encoding.TextMarshaler] and
// [encoding.TextUnmarshaler].
type marshalledPath string

func (p *marshalledPath) MarshalText() ([]byte, error) {
	return []byte(*p), nil
}

func (p *marshalledPath) UnmarshalText(text []byte) error {
	abs, err := filepath.Abs(string(text))
	if err != nil {
		return err
	}
	if info, err := os.Stat(filepath.Dir(abs)); err != nil {
		return err
	} else if !info.IsDir() {
		return fmt.Errorf("parent %s is not a directory", filepath.Dir(abs))
	}
	*p = marshalledPath(abs)
	return nil
}

func main() {
	outPath := marshalledPath("rancher-desktop.cpuprofile")
	flag.TextVar(&outPath, "out", &outPath, "File name to write the output to")
	flag.Parse()

	if err := run(context.Background(), outPath); err != nil {
		log.Fatal(err)
	}
}
