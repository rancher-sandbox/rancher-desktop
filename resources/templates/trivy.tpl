[
{{ $firstVulSet := true }}{{ range . }}{{ if $firstVulSet}} {{ $firstVulSet = false}} {{ else }}, {{end}}
  {
    "Target": "{{.Target}}",
    "Vulnerabilities": [
    {{ $firstVul := true }}{{ range .Vulnerabilities }}{{ if $firstVul}} {{ $firstVul = false}} {{ else }}, {{end}}{
      "Package": "{{.PkgName | js}}",
      "Severity": "{{.Severity | js}}",
      "Title": "{{.Title | js}}",
      "VulnerabilityID": "{{.VulnerabilityID | js}}",
      "InstalledVersion": "{{.InstalledVersion | js}}",
      "FixedVersion": "{{.FixedVersion | js}}",
      "PrimaryURL": "{{.PrimaryURL | js}}",
      "Description": "{{.Description | js}}"
    }
    {{ end }}
    ]
  }
{{ end }}
]
  
