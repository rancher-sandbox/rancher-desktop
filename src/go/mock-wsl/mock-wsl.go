package main

import (
	"encoding/json"
	"fmt"
	"log"
	"os"
	"strings"

	"golang.org/x/exp/slices"
	"golang.org/x/text/encoding/unicode"
)

const (
	ModeSequential = "sequential"
	ModeRepeated   = "repeated"
	ModeDefault    = ""
)

type commandEntry struct {
	Args    []string `json:"args"`
	Mode    string   `json:"mode,omitempty"`
	Stdout  string   `json:"stdout,omitempty"`
	Stderr  string   `json:"stderr,omitempty"`
	UTF16LE bool     `json:"utf16le,omitempty"`
	Code    int      `json:"code,omitempty"`
}

type configStruct struct {
	Commands []commandEntry `json:"commands"`
	Results  []bool         `json:"results,omitempty"`
	Errors   []string       `json:"errors,omitempty"`
}

func writeFile(file *os.File, config *configStruct, errFmt string, v ...any) {
	errString := ""
	if errFmt != "" {
		errString = fmt.Sprintf(errFmt, v...)
		config.Errors = append(config.Errors, errString)
	}
	if _, err := file.Seek(0, os.SEEK_SET); err != nil {
		log.Fatalf("Could not seek in config file: %s", err)
	}
	// Don't bother truncating: we allow for junk at end of file.
	enc := json.NewEncoder(file)
	enc.SetIndent("", "    ")
	if err := enc.Encode(&config); err != nil {
		log.Fatalf("Could not marshal results: %s", err)
	}
	if err := file.Close(); err != nil {
		log.Fatalf("Could not flush results: %s", err)
	}
	if errString != "" {
		log.Fatal(errString)
	}
}

func main() {
	confPath, ok := os.LookupEnv("RD_MOCK_WSL_DATA")
	if !ok {
		log.Fatalf("RD_MOCK_WSL_DATA not set")
	}

	var config configStruct
	file, err := os.OpenFile(confPath, os.O_RDWR, 0)
	if err != nil {
		log.Fatalf("Failed to open config file %s: %s", confPath, err)
	}
	defer file.Close()
	if err = lockFile(file); err != nil {
		log.Fatalf("Failed to lock config file %s: %s", confPath, err)
	}
	decoder := json.NewDecoder(file)
	decoder.DisallowUnknownFields()
	if err = decoder.Decode(&config); err != nil {
		log.Fatalf("Failed to unmarshal config file %s: %s", confPath, err)
	}

	if len(config.Commands) < 1 {
		writeFile(file, &config, "Could not find any commands")
	}
	if len(config.Results) < len(config.Commands) {
		newResults := make([]bool, len(config.Commands)-len(config.Results))
		config.Results = append(config.Results, newResults...)
	}

	index := 0
	matched := false
	cmd := commandEntry{}
	args := os.Args[1:]

	matchSequential := true
	for index, cmd = range config.Commands {
		if !slices.Equal(args, cmd.Args) {
			if !config.Results[index] {
				matchSequential = false
			}
			continue
		}
		switch cmd.Mode {
		case ModeSequential:
			if matchSequential && !config.Results[index] {
				matched = true
			}
		case ModeRepeated:
			matched = true
		case ModeDefault:
			if !config.Results[index] {
				matched = true
			}
		default:
			writeFile(file, &config, "Command %d (%s) has invalid mode %s",
				index, strings.Join(cmd.Args, " "), cmd.Mode)
		}
		if matched {
			break
		} else if !config.Results[index] {
			matchSequential = false
		}
	}

	if !matched {
		writeFile(file, &config, "Could not find command with args %s",
			strings.Join(args, " "))
	}
	config.Results[index] = true

	encoding := unicode.UTF8
	if cmd.UTF16LE {
		encoding = unicode.UTF16(unicode.LittleEndian, unicode.IgnoreBOM)
	}
	encoder := encoding.NewEncoder()

	if cmd.Stdout != "" {
		text, err := encoder.String(cmd.Stdout)
		if err != nil {
			writeFile(file, &config, "failed to encode stdout: %s", err)
		}
		fmt.Fprint(os.Stdout, text)
	}
	if cmd.Stderr != "" {
		text, err := encoder.String(cmd.Stderr)
		if err != nil {
			writeFile(file, &config, "failed to encode stderr: %s", err)
		}
		fmt.Fprint(os.Stderr, text)
	}

	writeFile(file, &config, "")
	os.Exit(cmd.Code)
}
