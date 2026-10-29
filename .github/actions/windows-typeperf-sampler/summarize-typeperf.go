// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: SUSE LLC
// SPDX-FileCopyrightText: The Rancher Desktop Authors

// summarize-typeperf reads a TSV file produced by typeperf (via relog
// from BLG) and prints a compact summary of system counters and top
// processes per sample.
//
// Usage:
//
//	go run .github/actions/windows-typeperf-sampler/summarize-typeperf.go <perf-data.tsv> [topN]
package main

import (
	"encoding/csv"
	"errors"
	"fmt"
	"io"
	"math"
	"os"
	"regexp"
	"slices"
	"strconv"
	"strings"
)

type procSnap struct {
	name    string
	pid     int
	cpu     float64
	wsMB    float64
	handles int
	threads int
}

// procIndex holds column indices for one process instance.
type procIndex struct {
	cpu     int
	ws      int
	pid     int
	handles int
	threads int
}

var headerRe = regexp.MustCompile(`\\Process\(([^)]+)\)\\(.+)$`)

func main() {
	if len(os.Args) < 2 {
		fmt.Fprintf(os.Stderr, "usage: summarize-typeperf <perf-data.tsv> [topN]\n")
		os.Exit(1)
	}
	topN := 10
	if len(os.Args) >= 3 {
		if n, err := strconv.Atoi(os.Args[2]); err == nil {
			topN = n
		}
	}

	f, err := os.Open(os.Args[1])
	if err != nil {
		fmt.Fprintf(os.Stderr, "open: %v\n", err)
		os.Exit(1)
	}
	defer f.Close()

	reader := csv.NewReader(f)
	reader.LazyQuotes = true
	if strings.HasSuffix(strings.ToLower(os.Args[1]), ".tsv") {
		reader.Comma = '\t'
	}

	headers, err := reader.Read()
	if err != nil {
		fmt.Fprintf(os.Stderr, "read header: %v\n", err)
		os.Exit(1)
	}

	// Build indices during single header pass.
	var sysColIdx []int
	sysNames := map[int]string{}
	processes := map[string]*procIndex{}
	instances := make([]string, 0, 256)

	for i, h := range headers {
		if i == 0 {
			continue
		}
		m := headerRe.FindStringSubmatch(h)
		if m == nil {
			sysColIdx = append(sysColIdx, i)
			sysNames[i] = stripMachine(h)
			continue
		}
		inst, counter := m[1], m[2]
		if inst == "_Total" || inst == "Idle" {
			continue
		}
		pi, ok := processes[inst]
		if !ok {
			pi = &procIndex{-1, -1, -1, -1, -1}
			processes[inst] = pi
			instances = append(instances, inst)
		}
		switch counter {
		case "% Processor Time":
			pi.cpu = i
		case "Working Set":
			pi.ws = i
		case "ID Process":
			pi.pid = i
		case "Handle Count":
			pi.handles = i
		case "Thread Count":
			pi.threads = i
		}
	}

	fmt.Printf("Processes tracked: %d\n", len(processes))

	rowNum := 0
	for {
		record, err := reader.Read()
		if errors.Is(err, io.EOF) {
			break
		}
		if err != nil {
			fmt.Fprintf(os.Stderr, "read row %d: %v\n", rowNum+1, err)
			break
		}
		rowNum++

		fmt.Printf("\n--- %s ---\n", record[0])

		// System counters
		fmt.Println("  System:")
		for _, ci := range sysColIdx {
			name := sysNames[ci]
			val, ok := parseFloat(record[ci])
			if !ok {
				fmt.Printf("    %-55s %10s\n", name, "(n/a)")
				continue
			}
			switch {
			case strings.Contains(name, "MBytes") || strings.Contains(name, "Queue Length"):
				fmt.Printf("    %-55s %10.0f\n", name, val)
			case strings.Contains(name, "%"):
				fmt.Printf("    %-55s %9.1f%%\n", name, val)
			case strings.Contains(name, "Bytes/sec"):
				fmt.Printf("    %-55s %8.1f KB/s\n", name, val/1024)
			case strings.Contains(name, "sec/Read") || strings.Contains(name, "sec/Write"):
				fmt.Printf("    %-55s %8.3f ms\n", name, val*1000)
			default:
				fmt.Printf("    %-55s %10.2f\n", name, val)
			}
		}

		// Per-process snapshots via precomputed indices
		snaps := make([]procSnap, 0, len(instances))
		for _, inst := range instances {
			pi := processes[inst]
			cpu, cpuOK := colFloat(record, pi.cpu)
			ws, wsOK := colFloat(record, pi.ws)
			if !cpuOK && !wsOK {
				continue
			}
			pid, _ := colInt(record, pi.pid)
			handles, _ := colInt(record, pi.handles)
			threads, _ := colInt(record, pi.threads)
			snaps = append(snaps, procSnap{
				name:    inst,
				pid:     pid,
				cpu:     cpu,
				wsMB:    ws / (1024 * 1024),
				handles: handles,
				threads: threads,
			})
		}

		printTopN(snaps, topN, "CPU", func(s procSnap) float64 { return s.cpu })
		printTopN(snaps, topN, "Working Set", func(s procSnap) float64 { return s.wsMB })
	}

	fmt.Printf("\nSamples: %d\n", rowNum)
}

func printTopN(snaps []procSnap, n int, label string, key func(procSnap) float64) {
	slices.SortFunc(snaps, func(a, b procSnap) int {
		return cmpDesc(key(a), key(b))
	})
	fmt.Printf("\n  Top %d by %s:\n", n, label)
	for i := range min(n, len(snaps)) {
		s := snaps[i]
		fmt.Printf("    %-30s PID %6d  CPU %7.1f%%  WS %8.1f MB  H %6d  T %4d\n",
			s.name, s.pid, s.cpu, s.wsMB, s.handles, s.threads)
	}
}

func colFloat(record []string, col int) (float64, bool) {
	if col < 0 || col >= len(record) {
		return 0, false
	}
	return parseFloat(record[col])
}

func colInt(record []string, col int) (int, bool) {
	v, ok := colFloat(record, col)
	if !ok {
		return 0, false
	}
	return int(math.Round(v)), true
}

func stripMachine(h string) string {
	if strings.HasPrefix(h, `\\`) {
		if idx := strings.Index(h[2:], `\`); idx >= 0 {
			return `\` + h[2+idx+1:]
		}
	}
	return h
}

func parseFloat(s string) (float64, bool) {
	s = strings.TrimSpace(s)
	if s == "" {
		return 0, false
	}
	v, err := strconv.ParseFloat(s, 64)
	if err != nil {
		return 0, false
	}
	return v, true
}

func cmpDesc(a, b float64) int {
	if a > b {
		return -1
	}
	if a < b {
		return 1
	}
	return 0
}
