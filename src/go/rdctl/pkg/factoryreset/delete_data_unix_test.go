//go:test !windows
//go:build !windows

/*
Copyright © 2022 SUSE LLC

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
package factoryreset

import (
	"fmt"
	"os"
	"path"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
)

/**
 * Copy all the dotfiles we care about into TMP/rd-dotfiles-copies and TMP/rd-dotfiles-working
 * Add fake management blocks to each file in TMP/rd-dotfiles-working
 * One of the files deliberately has no newline between its last line and the management block
 * Then call the removePathManagement() function on the working dot files
 * Then verify they're identical to the copied files
 * Clean up the temp dirs if everything matched
 */

var tempOriginalDotfilesDir string
var tempWorkingDotfilesDir string

var filenames []string
var predefinedContents map[string]string = map[string]string{
	"ends-with-text-eol":         "# line1a\n# line2a\n",
	"ends-with-blank-eol":        "# line1b\n# line2b\n\n",
	"ends-with-no-eol":           "# line1c\n# line2c",
	"will-have-no-extra-newline": "# line1d\n# line2d\n",
	"content-no-EOF-newline":     "# line1d\n# line2d\n",
	"empty-file-no-EOF-newline":  "",
	"empty-file":                 "",
}

var expectedAfterContents map[string]string = map[string]string{
	"ends-with-no-eol": "# line1c\n# line2c\n",
}

func getExpectedContents(filename string) (string, error) {
	text, ok := expectedAfterContents[filename]
	if ok {
		return text, nil
	}
	text, ok = predefinedContents[filename]
	if ok {
		return text, nil
	}
	return "", fmt.Errorf("Can't find contents for dotfile %q", filename)
}

func populateFiles() error {
	for baseName, text := range predefinedContents {
		fullPath := path.Join(tempWorkingDotfilesDir, baseName)
		f, err := os.OpenFile(fullPath, os.O_RDWR|os.O_CREATE|os.O_TRUNC, 0644)
		if err != nil {
			return err
		}
		f.Write([]byte(text))
		filenames = append(filenames, fullPath)
		f.Close()
		// And write the data into the original dir for reference
		fullPath = path.Join(tempOriginalDotfilesDir, baseName)
		f, err = os.OpenFile(fullPath, os.O_RDWR|os.O_CREATE|os.O_TRUNC, 0644)
		if err != nil {
			return err
		}
		f.Write([]byte(text))
		f.Close()
	}
	return nil
}

func setup() error {
	tempOriginalDotfilesDir = path.Join(os.TempDir(), "rd-dotfiles-copies")
	err := os.Mkdir(tempOriginalDotfilesDir, 0755)
	if err != nil && !os.IsExist(err) {
		return err
	}
	tempWorkingDotfilesDir = path.Join(os.TempDir(), "rd-dotfiles-working")
	err = os.Mkdir(tempWorkingDotfilesDir, 0755)
	if err != nil && !os.IsExist(err) {
		return err
	}
	return populateFiles()
}

func shutdown() {
	for _, dir := range []string{tempOriginalDotfilesDir, tempWorkingDotfilesDir} {
		err := os.RemoveAll(dir)
		if err != nil {
			fmt.Printf("Failed to delete tmpdir %s: %s\n", dir, err)
			break
		}
	}
}

func TestMain(m *testing.M) {
	if err := setup(); err != nil {
		fmt.Println("Failed to setup...")
		fmt.Println(err)
		os.Exit(1)
	}
	code := m.Run()
	if code != 0 {
		os.Exit(code)
	}
	shutdown()
}

const startTarget = "### MANAGED BY RANCHER DESKTOP START (DO NOT EDIT)"
const endTarget = "### MANAGED BY RANCHER DESKTOP END (DO NOT EDIT)"

func addBlock(dotFile string) error {
	byteContents, err := os.ReadFile(dotFile)
	if err != nil {
		return err
	}
	contents := string(byteContents)
	startPoint := strings.LastIndex(contents, startTarget)
	if startPoint >= 0 {
		return nil
	}
	// Overwrite the file...
	filestat, err := os.Stat(dotFile)
	if err != nil {
		return err
	}
	f, err := os.OpenFile(dotFile, os.O_APPEND|os.O_WRONLY, filestat.Mode())
	if err != nil {
		return err
	}
	if len(contents) > 0 && contents[len(contents)-1] != '\n' {
		f.Write([]byte("\n"))
	}
	if len(contents) > 0 && !strings.HasSuffix(dotFile, "will-have-no-extra-newline") {
		f.Write([]byte("\n"))
	}
	f.Write([]byte(startTarget))
	f.Write([]byte("\n"))
	f.Write([]byte("# SHAZBAT!\n"))
	f.Write([]byte(endTarget))
	if !strings.HasSuffix(dotFile, "no-EOF-newline") {
		f.Write([]byte("\n"))
	}
	return f.Close()
}

func TestAddManagedBlock(t *testing.T) {
	for _, path := range filenames {
		assert.NoError(t, addBlock(path))
	}
	for _, filename := range filenames {
		contents, err := os.ReadFile(filename)
		assert.NoError(t, err)
		assert.Contains(t, string(contents), "MANAGED BY RANCHER DESKTOP")
	}
}

func verifyMgmtRemoved(t *testing.T, dotFile string) {
	baseName := path.Base(dotFile)
	if strings.HasPrefix(baseName, "empty-file") {
		_, err := os.Stat(dotFile)
		assert.ErrorIs(t, err, os.ErrNotExist)
		return
	}
	byteContents, err := os.ReadFile(dotFile)
	assert.NoError(t, err)
	expectedContents, err := getExpectedContents(path.Base(dotFile))
	assert.NoError(t, err)
	assert.Equal(t, expectedContents, string(byteContents))
}

func TestRemoveManagedBlock(t *testing.T) {
	modifiedFileList := append(filenames, path.Join(tempWorkingDotfilesDir, ".no-such-file"))
	assert.NoError(t, removePathManagement(modifiedFileList))
	for _, dotFile := range filenames {
		verifyMgmtRemoved(t, dotFile)
	}
}
