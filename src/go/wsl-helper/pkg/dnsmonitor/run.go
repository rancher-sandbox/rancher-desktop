//go:build windows
// +build windows

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
package dnsmonitor

import (
	"bytes"
	"crypto/md5"
	"fmt"
	"net/netip"
	"os"
	"sort"

	"golang.org/x/sys/windows"
	"golang.zx2c4.com/wireguard/windows/tunnel/winipcfg"
)

func Run(path string) error {
	addrs, err := winipcfg.GetAdaptersAddresses(windows.AF_UNSPEC, winipcfg.GAAFlagIncludeAll)
	if err != nil {
		return err
	}
	var activeInterfaces []*winipcfg.IPAdapterAddresses
	for _, addr := range addrs {
		if addr.OperStatus == winipcfg.IfOperStatusUp && addr.FirstDNSServerAddress != nil {
			activeInterfaces = append(activeInterfaces, addr)
		}
	}

	infMetric := func(a1, a2 *winipcfg.IPAdapterAddresses) bool {
		return a1.Ipv4Metric < a2.Ipv4Metric
	}
	By(infMetric).Sort(activeInterfaces)
	dnsSrvs, err := activeInterfaces[0].LUID.DNS()
	if err != nil {
		return err
	}
	f, err := os.OpenFile(path, os.O_APPEND|os.O_CREATE|os.O_TRUNC, 0644)
	if err != nil {
		return err
	}
	defer f.Close()

	// check for same content before writing
	existingContent, err := os.ReadFile(f.Name())
	if err != nil {
		return err
	}

	oldChecksum := md5.Sum(existingContent)

	newContent := expectedResolveConf(dnsSrvs)
	newChecksum := md5.Sum(newContent.Bytes())

	// only write if different servers exist
	if oldChecksum != newChecksum {
		_, err := f.Write(newContent.Bytes())
		if err != nil {
			return err
		}
	}
	return nil
}

func expectedResolveConf(dnsSrvs []netip.Addr) (b bytes.Buffer) {
	// for debugging purpose
	b.WriteString("# This file was last edited by dnsMonitor of WSL-Helper\n")
	for _, srv := range dnsSrvs {
		line := fmt.Sprintf("nameserver %s\n", srv)
		b.WriteString(line)
	}
	return b
}

// By is the type of a "less" function that defines the ordering of its addresses arguments.
type By func(a1, a2 *winipcfg.IPAdapterAddresses) bool

// Sort is a method on the function type, By, that sorts the argument slice according to the function.
func (by By) Sort(addresses []*winipcfg.IPAdapterAddresses) {
	ps := &infSorter{
		adapterAddrs: addresses,
		by:           by, // The Sort method's receiver is the function (closure) that defines the sort order.
	}
	sort.Sort(ps)
}

// infSorter joins a By function and a slice of IPAdapterAddresses to be sorted.
type infSorter struct {
	adapterAddrs []*winipcfg.IPAdapterAddresses
	by           func(a1, a2 *winipcfg.IPAdapterAddresses) bool // Closure used in the Less method.
}

// Len is part of sort.Interface.
func (s *infSorter) Len() int {
	return len(s.adapterAddrs)
}

// Swap is part of sort.Interface.
func (s *infSorter) Swap(i, j int) {
	s.adapterAddrs[i], s.adapterAddrs[j] = s.adapterAddrs[j], s.adapterAddrs[i]
}

// Less is part of sort.Interface. It is implemented by calling the "by" closure in the sorter.
func (s *infSorter) Less(i, j int) bool {
	return s.by(s.adapterAddrs[i], s.adapterAddrs[j])
}
