package snapshot

import (
	"errors"
	"fmt"
	"io"
	"math/rand"
	"os"
	"time"
)

func init() {
	rand.Seed(time.Now().UnixNano())
}

// Returns a string of length n that is comprised of random letters
// and numbers. From:
// https://stackoverflow.com/questions/22892120/how-to-generate-a-random-string-of-a-fixed-length-in-go
func randomString(n int) string {
	letters := "abcdefghijklmnopqrstuvwxyz0123456789"
	b := make([]byte, n)
	for i := range b {
		b[i] = letters[rand.Intn(len(letters))]
	}
	return string(b)
}

func copyFile(dst, src string, notExistOk bool) error {
	srcFd, err := os.Open(src)
	if errors.Is(err, os.ErrNotExist) && notExistOk {
		return nil
	} else if err != nil {
		return fmt.Errorf("failed to open source file: %w", err)
	}
	defer srcFd.Close()
	dstFd, err := os.Create(dst)
	if err != nil {
		return fmt.Errorf("failed to open destination file: %w", err)
	}
	defer dstFd.Close()
	if _, err := io.Copy(dstFd, srcFd); err != nil {
		return fmt.Errorf("failed to copy contents of src to dst: %w", err)
	}
	return nil
}
