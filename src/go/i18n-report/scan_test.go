package main

import (
	"regexp"
	"testing"
)

func TestKeyPatterns(t *testing.T) {
	tests := []struct {
		name    string
		line    string
		wantKey string // empty means no match expected
	}{
		// keyPattern: t('key'), t("key"), t(`key`), this.t(), $t()
		{"t single quotes", `t('action.refresh')`, "action.refresh"},
		{"t double quotes", `t("action.refresh")`, "action.refresh"},
		{"t backtick", "t(`action.refresh`)", "action.refresh"},
		{"this.t", `this.t('app.title')`, "app.title"},
		{"$t", `$t('nav.home')`, "nav.home"},
		{"preceded by space", ` t('key.name')`, "key.name"},
		{"not preceded by letter", `xt('key.name')`, ""}, // "xt" has letter before t

		// keyPropPattern: titleKey/descriptionKey/labelKey with string values
		{"titleKey", `titleKey: 'page.title'`, "page.title"},
		{"labelKey double", `labelKey: "tab.label"`, "tab.label"},
		{"descriptionKey", `descriptionKey: 'desc.key'`, "desc.key"},

		// labelKeyAttrPattern: label-key="..." in Vue templates
		{"label-key attr", `label-key="menu.item"`, "menu.item"},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			var found string

			for _, pat := range []*regexp.Regexp{keyPattern, keyPropPattern, labelKeyAttrPattern} {
				if m := pat.FindStringSubmatch(tc.line); m != nil {
					found = m[1]
					break
				}
			}

			if tc.wantKey == "" && found != "" {
				t.Errorf("expected no match, got %q", found)
			} else if tc.wantKey != "" && found != tc.wantKey {
				t.Errorf("got %q, want %q", found, tc.wantKey)
			}
		})
	}
}

func TestDottedKeyLiteral(t *testing.T) {
	tests := []struct {
		name    string
		line    string
		wantKey string
	}{
		{"quoted dotted key", `titleKey: isAdmin ? 'admin.title' : 'user.title'`, "admin.title"},
		{"no dotted key", `titleKey: 'single'`, ""},
		{"uppercase start", `"Admin.title"`, ""}, // must start lowercase
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			m := dottedKeyLiteral.FindStringSubmatch(tc.line)
			var found string
			if m != nil {
				found = m[1]
			}
			if tc.wantKey == "" && found != "" {
				t.Errorf("expected no match, got %q", found)
			} else if tc.wantKey != "" && found != tc.wantKey {
				t.Errorf("got %q, want %q", found, tc.wantKey)
			}
		})
	}
}

func TestIndirectKeyPattern(t *testing.T) {
	tests := []struct {
		name    string
		line    string
		wantKey string
	}{
		{"property assignment", `bar: 'product.kubernetesVersion'`, "product.kubernetesVersion"},
		{"quoted property", `'some-prop': "container.engine"`, "container.engine"},
		{"no dotted value", `bar: 'simple'`, ""},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			m := indirectKeyPattern.FindStringSubmatch(tc.line)
			var found string
			if m != nil {
				found = m[1]
			}
			if tc.wantKey == "" && found != "" {
				t.Errorf("expected no match, got %q", found)
			} else if tc.wantKey != "" && found != tc.wantKey {
				t.Errorf("got %q, want %q", found, tc.wantKey)
			}
		})
	}
}

