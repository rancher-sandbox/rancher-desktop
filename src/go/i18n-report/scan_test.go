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

		// vtDirectivePattern: v-t="'...'" Vue directive
		{"v-t directive", `<span v-t="'sortableTable.noActions'" />`, "sortableTable.noActions"},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			var found string

			for _, pat := range []*regexp.Regexp{keyPattern, keyPropPattern, labelKeyAttrPattern, vtDirectivePattern} {
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

func TestDynamicKeyLiteral(t *testing.T) {
	tests := []struct {
		name        string
		line        string
		wantPattern string // empty means no match expected
	}{
		{
			"direct t() with interpolation",
			"this.t(`containerEngine.options.${ x }.label`)",
			"containerEngine.options.{}.label",
		},
		{
			"two interpolations",
			"const key = `asyncButton.${ this.mode }.${ this.phase }`;",
			"asyncButton.{}.{}",
		},
		{
			"interpolation with suffix",
			"const key = `asyncButton.${ this.mode }.${ this.phase }Icon`;",
			"asyncButton.{}.{}Icon",
		},
		{
			"static prefix with single interpolation",
			"this.t(`snapshots.dialog.${ type }.actions.ok`)",
			"snapshots.dialog.{}.actions.ok",
		},
		{
			"no interpolation (literal key)",
			"t(`action.refresh`)",
			"",
		},
		{
			"no dot prefix",
			"`${ prefix }.key`",
			"",
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			ref := keyReference{File: "test.ts", Line: 1}
			dynamics := extractDynamicPatterns(tc.line, ref)

			if tc.wantPattern == "" {
				if len(dynamics) > 0 {
					t.Errorf("expected no match, got %q", dynamics[0].Pattern)
				}
			} else {
				if len(dynamics) == 0 {
					t.Fatalf("expected pattern %q, got no match", tc.wantPattern)
				}
				if dynamics[0].Pattern != tc.wantPattern {
					t.Errorf("got pattern %q, want %q", dynamics[0].Pattern, tc.wantPattern)
				}
			}
		})
	}
}

func TestTemplateToKeyRegex(t *testing.T) {
	tests := []struct {
		template string
		key      string
		matches  bool
	}{
		{"containerEngine.options.${x}.label", "containerEngine.options.moby.label", true},
		{"containerEngine.options.${x}.label", "containerEngine.options.containerd.label", true},
		{"containerEngine.options.${x}.label", "containerEngine.options.label", false},     // no segment
		{"containerEngine.options.${x}.label", "containerEngine.label", false},              // different structure
		{"asyncButton.${mode}.${phase}", "asyncButton.edit.action", true},
		{"asyncButton.${mode}.${phase}", "asyncButton.default.success", true},
		{"asyncButton.${mode}.${phase}", "asyncButton.edit", false},                        // too few segments
		{"asyncButton.${mode}.${phase}Icon", "asyncButton.edit.actionIcon", true},
		{"asyncButton.${mode}.${phase}Icon", "asyncButton.edit.action", false},             // missing Icon suffix
		{"virtualMachine.type.options.${x}.label", "virtualMachine.type.options.qemu.label", true},
		{"virtualMachine.type.options.${x}.label", "virtualMachine.type.options.vz.label", true},
		{"snapshots.dialog.${type}.actions.ok", "snapshots.dialog.delete.actions.ok", true},
		{"snapshots.dialog.${type}.actions.ok", "snapshots.dialog.restore.actions.ok", true},
		{"snapshots.dialog.${type}.actions.ok", "snapshots.info.create.success", false},    // different prefix
	}

	for _, tc := range tests {
		t.Run(tc.template+"→"+tc.key, func(t *testing.T) {
			re := templateToKeyRegex(tc.template)
			if re == nil {
				t.Fatal("templateToKeyRegex returned nil")
			}
			got := re.MatchString(tc.key)
			if got != tc.matches {
				t.Errorf("regex %q.MatchString(%q) = %v, want %v", re.String(), tc.key, got, tc.matches)
			}
		})
	}
}
