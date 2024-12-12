package main

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"slices"
	"sort"
	"strconv"
	"strings"

	"golang.org/x/mod/semver"
)

// golang.org/x/mod/semver *requires* a leading 'v' on versions, and will add missing minor/patch numbers.
var minimumVersion = "v1.21"

type Channels struct {
	Data []Channel `json:"data"`
}
type Channel struct {
	Name   string `json:"name"`
	Latest string `json:"latest"`
}

// getK3sChannels returns a map of all non-prerelease channels, plus "latest" and "stable".
// The values are the latest release for each channel.
func getK3sChannels() (map[string]string, error) {
	resp, err := http.Get("https://update.k3s.io/v1-release/channels")
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("Update channel request failed with status: %s", resp.Status)
	}

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, err
	}

	var channels Channels
	if err := json.Unmarshal(body, &channels); err != nil {
		return nil, err
	}

	k3sChannels := make(map[string]string)
	for _, channel := range channels.Data {
		switch {
		case channel.Name == "latest" || channel.Name == "stable":
			break
		case semver.Prerelease(channel.Latest) != "":
			continue
		case semver.IsValid(channel.Latest) && semver.Compare(channel.Latest, minimumVersion) >= 0:
			break
		default:
			continue
		}
		k3sChannels[channel.Name] = channel.Latest
	}

	return k3sChannels, nil
}

type GithubRelease struct {
	TagName    string `json:"tag_name"`
	Draft      bool   `json:"draft"`
	Prerelease bool   `json:"prerelease"`
}

// getGithubReleasesPage fetches a single page of GitHub releases and returns a list
// of all non-draft, non-prerelease releases higher than the minimumVersion.
func getGithubReleasesPage(page int) ([]GithubRelease, error) {
	url := fmt.Sprintf("https://api.github.com/repos/k3s-io/k3s/releases?page=%d", page)
	req, err := http.NewRequest("GET", url, nil)
	if err != nil {
		return nil, err
	}
	token := os.Getenv("GH_TOKEN")
	if token == "" {
		token = os.Getenv("GITHUB_TOKEN")
	}
	if token != "" {
		req.Header.Set("Authorization", "token "+token)
	}

	client := &http.Client{}
	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("GitHub API request failed with status: %s", resp.Status)
	}

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, err
	}

	var releases []GithubRelease
	if err := json.Unmarshal(body, &releases); err != nil {
		return nil, err
	}

	// Filter desired releases here, so caller will stop requesting additional pages if there are
	// no more matches (heuristics, but releases are returned in reverse chronological order).
	releases = slices.DeleteFunc(releases, func(release GithubRelease) bool {
		return release.Draft || release.Prerelease || semver.Compare(release.TagName, minimumVersion) < 0
	})
	return releases, nil
}

// getGithubReleases returns a sorted list of all matching GitHub releases.
func getGithubReleases() ([]string, error) {
	releaseMap := make(map[string]string)
	for page := 1; ; page++ {
		releases, err := getGithubReleasesPage(page)
		if err != nil {
			return nil, err
		}
		if len(releases) == 0 {
			break
		}
		for _, release := range releases {
			version := semver.Canonical(release.TagName)
			// for each version we only keep the latest k3s patch, i.e. +k3s2 instead of +k3s1
			if oldTag, ok := releaseMap[version]; ok {
				oldPatch, _ := strconv.Atoi(strings.TrimPrefix(semver.Build(oldTag), "+k3s"))
				patch, _ := strconv.Atoi(strings.TrimPrefix(semver.Build(release.TagName), "+k3s"))
				if oldPatch > patch {
					continue
				}
			}
			releaseMap[version] = release.TagName
		}
	}

	var versions []string
	for _, version := range releaseMap {
		versions = append(versions, version)
	}

	sort.Slice(versions, func(i, j int) bool {
		return semver.Compare(versions[i], versions[j]) < 0
	})

	return versions, nil
}

func main() {
	if len(os.Args) > 1 {
		minimumVersion = os.Args[1]
	}
	if !semver.IsValid(minimumVersion) {
		panic(fmt.Errorf("minimum version %q is not a valid version, e.g. needs to start with 'v'", minimumVersion))
	}

	k3sChannels, err := getK3sChannels()
	if err != nil {
		panic(fmt.Errorf("error fetching k3s channels: %w", err))
	}

	githubReleases, err := getGithubReleases()
	if err != nil {
		panic(fmt.Errorf("error fetching GitHub releases: %w", err))
	}

	result := map[string]interface{}{
		"cacheVersion": 2,
		"channels":     k3sChannels,
		"versions":     githubReleases,
	}

	// json.Marshal will produce map keys in sort order
	jsonResult, err := json.MarshalIndent(result, "", "  ")
	if err != nil {
		panic(fmt.Errorf("error marshalling result to JSON: %w", err))
	}

	fmt.Println(string(jsonResult))
}
