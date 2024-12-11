package process

import (
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"golang.org/x/sys/windows"
)

func TestBuildCommandLine(t *testing.T) {
	t.Parallel()
	cases := [][]string{
		{"arg0", "a b c", "d", "e"},
		{"C:\\Program Files\\arg0\\\\", "ab\"c", "\\", "d"},
		{"\\\\", "a\\\\\\b", "de fg", "h"},
		{"arg0", "a\\\"b", "c", "d"},
		{"arg0", "a\\\\b c", "d", "e"},
		{"arg0", "ab\" c d"},
		{"C:/Path\\with/mixed slashes"},
		{"arg0", " leading", " and ", "trailing ", "space"},
		{"special characters", "&", "|", ">", "<", "*", "\"", " "},
	}
	for _, testcase := range cases {
		t.Run(strings.Join(testcase, " "), func(t *testing.T) {
			t.Parallel()
			result := buildCommandLine(testcase)
			argv, err := windows.DecomposeCommandLine(result)
			require.NoError(t, err, "failed to parse result %s", result)
			assert.Equal(t, testcase, argv, "failed to round trip arguments via [%s]", result)
		})
	}
}
