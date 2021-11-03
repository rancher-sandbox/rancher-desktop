package dockerproxy

import (
	"flag"
	"testing"

	"github.com/sirupsen/logrus"
	"github.com/stretchr/testify/assert"
)

func TestMain(m *testing.M) {
	flag.Parse()
	if testing.Verbose() {
		logrus.SetLevel(logrus.DebugLevel)
	}
	m.Run()
}

func TestDetecteAPIVersion(t *testing.T) {
	t.Parallel()
	munger := newRequestMunger()
	cases := map[string]struct {
		version string
		path    string
	}{
		"/_ping":     {"", "/_ping"},
		"/foo":       {defaultDockerVersion, "/foo"},
		"/v1.23/foo": {"v1.23", "/foo"},
	}

	for input, expected := range cases {
		t.Run(input, func(t *testing.T) {
			version, path := munger.detectAPIVersion(input)
			assert.Equal(t, version, expected.version)
			assert.Equal(t, path, expected.path)
		})
	}
}
