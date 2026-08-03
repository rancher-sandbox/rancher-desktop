// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: SUSE LLC
// SPDX-FileCopyrightText: The Rancher Desktop Authors

package main

import (
	"fmt"
	"sort"
	"strings"
)

// This file implements a small recursive-descent parser for the subset of
// ICU MessageFormat that the app's translation strings use, mirroring the
// behavior of intl-messageformat 11 (the runtime library). It is used by the
// validator to compare placeholders and plural/select structure between the
// English source and a locale translation.
//
// Grammar handled:
//
//	message   := (text | argument)*
//	argument  := '{' name '}'
//	           | '{' name ',' type '}'                       (typed simple arg)
//	           | '{' name ',' type ',' style '}'             (typed arg, style ignored)
//	           | '{' name ',' keyword ',' branch+ '}'        (keyword ∈ plural|select|selectordinal)
//	branch    := label '{' message '}'
//	label     := '=' digits | identifier                    (=N only for plural/selectordinal)
//
// Apostrophe handling follows ICU "lenient" mode as implemented by
// intl-messageformat: '' is a literal apostrophe; an apostrophe immediately
// followed by one of { } < > (or # inside a plural/selectordinal branch)
// starts a quoted literal that runs to the next lone apostrophe, in which
// { } # are not special; any other apostrophe is a literal character.
//
// Inside a plural/selectordinal branch, '#' is the number substitution and is
// tracked as a reference to the construct's variable.

// icuKind identifies the kind of an AST node.
type icuKind int

const (
	icuText   icuKind = iota // literal text
	icuArg                   // {name} or {name, type[, style]}
	icuSelect                // {name, plural|select|selectordinal, branches}
	icuPound                 // '#' number substitution inside a plural branch
)

// icuNode is a node in the parsed message tree.
type icuNode struct {
	kind     icuKind
	text     string      // icuText: the literal text
	name     string      // icuArg/icuSelect: variable name; icuPound: the plural variable it references
	keyword  string      // icuSelect: plural, select, or selectordinal
	branches []icuBranch // icuSelect: the branches
}

// icuBranch is one branch of a plural/select/selectordinal construct.
type icuBranch struct {
	label string
	body  []icuNode
}

const keywordPlural = "plural"

// icuSelectKeywords are the ICU keywords that introduce branching.
var icuSelectKeywords = map[string]bool{
	keywordPlural:   true,
	"select":        true,
	"selectordinal": true,
}

// parseICU parses an ICU MessageFormat string into a message tree. Errors
// carry the byte offset at which parsing failed.
func parseICU(msg string) ([]icuNode, error) {
	p := &icuParser{src: msg}
	nodes, err := p.parseMessage("", false)
	if err != nil {
		return nil, err
	}
	if p.pos < len(p.src) {
		// Only a stray '}' can stop parseMessage before EOF at the top level.
		return nil, p.errf("unexpected %q", string(p.src[p.pos]))
	}
	return nodes, nil
}

type icuParser struct {
	src string
	pos int
}

func (p *icuParser) errf(format string, args ...any) error {
	return fmt.Errorf("ICU parse error at position %d: %s", p.pos, fmt.Sprintf(format, args...))
}

// parseMessage parses a sequence of text and arguments. pluralVar is the
// variable of the nearest enclosing plural/selectordinal (empty if none), which
// makes '#' significant. When nested is true, an unquoted '}' ends the message.
func (p *icuParser) parseMessage(pluralVar string, nested bool) ([]icuNode, error) {
	var nodes []icuNode
	for p.pos < len(p.src) {
		c := p.src[p.pos]
		switch {
		case c == '{':
			node, err := p.parseArgument()
			if err != nil {
				return nil, err
			}
			nodes = append(nodes, node)
		case c == '}':
			if nested {
				return nodes, nil
			}
			return nil, p.errf("unexpected %q", "}")
		case c == '#' && pluralVar != "":
			p.pos++
			nodes = append(nodes, icuNode{kind: icuPound, name: pluralVar})
		default:
			nodes = append(nodes, icuNode{kind: icuText, text: p.parseText(pluralVar)})
		}
	}
	if nested {
		return nil, p.errf("unterminated branch: expected %q", "}")
	}
	return nodes, nil
}

// isQuoteStart reports whether an apostrophe followed by c starts a quoted
// literal, matching intl-messageformat's lenient apostrophe mode.
func isQuoteStart(c byte, pluralVar string) bool {
	switch c {
	case '{', '}', '<', '>':
		return true
	case '#':
		return pluralVar != ""
	}
	return false
}

// parseText reads a run of literal text, resolving apostrophe quoting. It
// stops at an unquoted '{', '}', or (when pluralVar is set) '#'.
func (p *icuParser) parseText(pluralVar string) string {
	var b strings.Builder
	for p.pos < len(p.src) {
		c := p.src[p.pos]
		if c == '{' || c == '}' {
			break
		}
		if c == '#' && pluralVar != "" {
			break
		}
		if c == '\'' {
			// '' is a literal apostrophe.
			if p.pos+1 < len(p.src) && p.src[p.pos+1] == '\'' {
				b.WriteByte('\'')
				p.pos += 2
				continue
			}
			// A quote start begins a literal region ending at the next lone '.
			if p.pos+1 < len(p.src) && isQuoteStart(p.src[p.pos+1], pluralVar) {
				p.pos++ // opening apostrophe
				for p.pos < len(p.src) {
					if p.src[p.pos] == '\'' {
						if p.pos+1 < len(p.src) && p.src[p.pos+1] == '\'' {
							b.WriteByte('\'')
							p.pos += 2
							continue
						}
						p.pos++ // closing apostrophe
						break
					}
					b.WriteByte(p.src[p.pos])
					p.pos++
				}
				continue
			}
			// A lone apostrophe is a literal character.
			b.WriteByte('\'')
			p.pos++
			continue
		}
		b.WriteByte(c)
		p.pos++
	}
	return b.String()
}

// parseArgument parses an argument starting at the opening brace.
func (p *icuParser) parseArgument() (icuNode, error) {
	p.pos++ // opening brace
	p.skipSpaces()
	name := p.parseIdent()
	if name == "" {
		return icuNode{}, p.errf("expected argument name")
	}
	p.skipSpaces()
	if p.pos >= len(p.src) {
		return icuNode{}, p.errf("unterminated argument")
	}
	if p.src[p.pos] == '}' {
		p.pos++
		return icuNode{kind: icuArg, name: name}, nil
	}
	if p.src[p.pos] != ',' {
		return icuNode{}, p.errf("expected %q or %q after argument name", ",", "}")
	}
	p.pos++ // comma
	p.skipSpaces()
	keyword := p.parseIdent()
	if keyword == "" {
		return icuNode{}, p.errf("expected argument type")
	}
	p.skipSpaces()

	if icuSelectKeywords[keyword] {
		if p.pos >= len(p.src) || p.src[p.pos] != ',' {
			return icuNode{}, p.errf("expected %q before %s branches", ",", keyword)
		}
		p.pos++ // comma
		branches, err := p.parseBranches(name, keyword)
		if err != nil {
			return icuNode{}, err
		}
		if p.pos >= len(p.src) || p.src[p.pos] != '}' {
			return icuNode{}, p.errf("unterminated %s argument", keyword)
		}
		p.pos++ // closing brace
		return icuNode{kind: icuSelect, name: name, keyword: keyword, branches: branches}, nil
	}

	// Typed simple argument, e.g. {count, number} or {when, date, short}.
	if p.pos < len(p.src) && p.src[p.pos] == ',' {
		p.pos++ // comma
		if err := p.skipArgStyle(); err != nil {
			return icuNode{}, err
		}
	}
	if p.pos >= len(p.src) || p.src[p.pos] != '}' {
		return icuNode{}, p.errf("unterminated argument")
	}
	p.pos++ // closing brace
	return icuNode{kind: icuArg, name: name}, nil
}

// parseBranches parses the branches of a plural/select/selectordinal, stopping
// at the closing brace. pluralVar is passed to branch bodies only for
// plural/selectordinal so that '#' resolves to this construct's variable.
func (p *icuParser) parseBranches(variable, keyword string) ([]icuBranch, error) {
	branchPlural := ""
	if keyword == keywordPlural || keyword == "selectordinal" {
		branchPlural = variable
	}
	var branches []icuBranch
	for {
		p.skipSpaces()
		if p.pos >= len(p.src) {
			return nil, p.errf("unterminated %s argument", keyword)
		}
		if p.src[p.pos] == '}' {
			break
		}
		label := p.parseBranchLabel()
		if label == "" {
			return nil, p.errf("expected branch label in %s argument", keyword)
		}
		p.skipSpaces()
		if p.pos >= len(p.src) || p.src[p.pos] != '{' {
			return nil, p.errf("expected %q after branch label %q", "{", label)
		}
		p.pos++ // opening brace of branch body
		body, err := p.parseMessage(branchPlural, true)
		if err != nil {
			return nil, err
		}
		if p.pos >= len(p.src) || p.src[p.pos] != '}' {
			return nil, p.errf("unterminated branch %q", label)
		}
		p.pos++ // closing brace of branch body
		branches = append(branches, icuBranch{label: label, body: body})
	}
	if len(branches) == 0 {
		return nil, p.errf("%s argument has no branches", keyword)
	}
	return branches, nil
}

// skipArgStyle consumes a typed argument's style up to (but not including) the
// argument's closing brace, honoring nested braces.
func (p *icuParser) skipArgStyle() error {
	depth := 0
	for p.pos < len(p.src) {
		switch p.src[p.pos] {
		case '{':
			depth++
		case '}':
			if depth == 0 {
				return nil
			}
			depth--
		}
		p.pos++
	}
	return p.errf("unterminated argument style")
}

// parseIdent reads an identifier ([A-Za-z0-9_]+).
func (p *icuParser) parseIdent() string {
	start := p.pos
	for p.pos < len(p.src) {
		c := p.src[p.pos]
		if (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9') || c == '_' {
			p.pos++
			continue
		}
		break
	}
	return p.src[start:p.pos]
}

// parseBranchLabel reads a branch label: a run up to the next space or brace.
// This accepts '=N' exact-match labels and arbitrary select keys.
func (p *icuParser) parseBranchLabel() string {
	start := p.pos
	for p.pos < len(p.src) {
		c := p.src[p.pos]
		if c == ' ' || c == '\t' || c == '\n' || c == '\r' || c == '{' || c == '}' {
			break
		}
		p.pos++
	}
	return p.src[start:p.pos]
}

func (p *icuParser) skipSpaces() {
	for p.pos < len(p.src) {
		switch p.src[p.pos] {
		case ' ', '\t', '\n', '\r':
			p.pos++
		default:
			return
		}
	}
}

// icuArgumentNames returns the set of every argument name referenced anywhere
// in the message, recursively. This includes plural/select variables and '#'
// references (which resolve to their enclosing plural variable).
func icuArgumentNames(nodes []icuNode) map[string]bool {
	result := make(map[string]bool)
	collectArgumentNames(nodes, result)
	return result
}

func collectArgumentNames(nodes []icuNode, result map[string]bool) {
	for _, n := range nodes {
		switch n.kind {
		case icuArg, icuPound:
			result[n.name] = true
		case icuSelect:
			result[n.name] = true
			for _, b := range n.branches {
				collectArgumentNames(b.body, result)
			}
		}
	}
}

// icuConstruct is a structural summary of a plural/select/selectordinal
// construct and its nested constructs, used for comparing structure between
// two translations.
type icuConstruct struct {
	Variable string
	Keyword  string
	Branches []string       // branch labels, sorted
	Nested   []icuConstruct // nested constructs, sorted
}

// icuConstructs returns the tree of plural/select/selectordinal constructs in
// the message. Top-level constructs are returned sorted; nested constructs are
// attached to their enclosing construct.
func icuConstructs(nodes []icuNode) []icuConstruct {
	var constructs []icuConstruct
	for _, n := range nodes {
		if n.kind != icuSelect {
			continue
		}
		labels := make([]string, 0, len(n.branches))
		var nested []icuConstruct
		for _, b := range n.branches {
			labels = append(labels, b.label)
			nested = append(nested, icuConstructs(b.body)...)
		}
		sort.Strings(labels)
		sortConstructs(nested)
		constructs = append(constructs, icuConstruct{
			Variable: n.name,
			Keyword:  n.keyword,
			Branches: labels,
			Nested:   nested,
		})
	}
	sortConstructs(constructs)
	return constructs
}

func sortConstructs(cs []icuConstruct) {
	sort.Slice(cs, func(i, j int) bool {
		if cs[i].Variable != cs[j].Variable {
			return cs[i].Variable < cs[j].Variable
		}
		return cs[i].Keyword < cs[j].Keyword
	})
}
