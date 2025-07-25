package wsl

import "context"

type MockWSL struct{}

func (wsl MockWSL) UnregisterDistros(ctx context.Context) error {
	return nil
}

func (wsl MockWSL) ExportDistro(ctx context.Context, distroName, fileName string) error {
	return nil
}

func (wsl MockWSL) ImportDistro(ctx context.Context, distroName, installLocation, fileName string) error {
	return nil
}
