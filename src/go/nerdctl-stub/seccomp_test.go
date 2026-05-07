package main

import (
	"testing"

	"github.com/stretchr/testify/assert"
)

func TestSeccompInjectionPos(t *testing.T) {
	t.Parallel()
	tests := []struct {
		name string
		args []string
		want int
	}{
		{
			name: "run with no global flags",
			args: []string{"run", "alpine"},
			want: 1,
		},
		{
			name: "create with no global flags",
			args: []string{"create", "alpine"},
			want: 1,
		},
		{
			name: "container run",
			args: []string{"container", "run", "alpine"},
			want: 2,
		},
		{
			name: "container create",
			args: []string{"container", "create", "alpine"},
			want: 2,
		},
		{
			name: "run after --address (stub path)",
			args: []string{"--address", "/run/k3s/containerd/containerd.sock", "run", "alpine"},
			want: 3,
		},
		{
			name: "run after --namespace",
			args: []string{"--namespace", "buildkit", "run", "alpine"},
			want: 3,
		},
		{
			name: "run after --debug boolean flag",
			args: []string{"--debug", "run", "alpine"},
			want: 2,
		},
		{
			name: "run after --address=... inline value",
			args: []string{"--address=/run/k3s/containerd/containerd.sock", "run", "alpine"},
			want: 2,
		},
		{
			name: "not a run/create command",
			args: []string{"ps"},
			want: -1,
		},
		{
			name: "container exec (not run/create)",
			args: []string{"container", "exec", "alpine"},
			want: -1,
		},
		{
			name: "empty args",
			args: []string{},
			want: -1,
		},
		{
			name: "only global flags",
			args: []string{"--debug"},
			want: -1,
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			assert.Equal(t, tt.want, seccompInjectionPos(tt.args))
		})
	}
}

func TestInjectSeccompOpt(t *testing.T) {
	t.Parallel()
	profile := "seccomp=" + seccompProfile

	injected := func(args ...string) []string {
		pos := seccompInjectionPos(args)
		out := make([]string, 0, len(args)+2)
		out = append(out, args[:pos]...)
		out = append(out, "--security-opt", "seccomp="+seccompProfile)
		out = append(out, args[pos:]...)
		return out
	}

	t.Run("injects for run", func(t *testing.T) {
		t.Parallel()
		args := []string{"--address", "/sock", "run", "alpine"}
		got := injectSeccompOpt(args)
		assert.Equal(t, injected(args...), got)
	})

	t.Run("injects for container run", func(t *testing.T) {
		t.Parallel()
		args := []string{"container", "run", "alpine"}
		got := injectSeccompOpt(args)
		assert.Equal(t, injected(args...), got)
	})

	t.Run("no double inject when --security-opt seccomp= already set", func(t *testing.T) {
		t.Parallel()
		args := []string{"run", "--security-opt", profile, "alpine"}
		got := injectSeccompOpt(args)
		assert.Equal(t, args, got)
	})

	t.Run("no double inject when --security-opt=seccomp= already set", func(t *testing.T) {
		t.Parallel()
		args := []string{"run", "--security-opt=" + profile, "alpine"}
		got := injectSeccompOpt(args)
		assert.Equal(t, args, got)
	})

	t.Run("no double inject when other seccomp profile set", func(t *testing.T) {
		t.Parallel()
		args := []string{"run", "--security-opt", "seccomp=/custom.json", "alpine"}
		got := injectSeccompOpt(args)
		assert.Equal(t, args, got)
	})

	t.Run("no inject for non-run commands", func(t *testing.T) {
		t.Parallel()
		args := []string{"ps"}
		got := injectSeccompOpt(args)
		assert.Equal(t, args, got)
	})

	t.Run("no inject when caller sets seccomp=unconfined", func(t *testing.T) {
		t.Parallel()
		args := []string{"run", "--security-opt", "seccomp=unconfined", "alpine"}
		got := injectSeccompOpt(args)
		assert.Equal(t, args, got)
	})

	t.Run("injects when --security-opt has a non-seccomp value", func(t *testing.T) {
		t.Parallel()
		args := []string{"run", "--security-opt", "no-new-privileges", "alpine"}
		got := injectSeccompOpt(args)
		assert.Equal(t, injected(args...), got)
	})
}
