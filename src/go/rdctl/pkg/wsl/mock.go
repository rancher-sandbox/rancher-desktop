package wsl

type MockWSL struct{}

func (wsl MockWSL) UnregisterDistros() error {
	return nil
}

func (wsl MockWSL) ExportDistro(distroName, fileName string) error {
	return nil
}

func (wsl MockWSL) ImportDistro(distroName, installLocation, fileName string) error {
	return nil
}
