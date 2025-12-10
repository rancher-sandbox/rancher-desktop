package main

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"maps"
	"net/http"
	"os"
	"slices"
	"strconv"
	"strings"

	"golang.org/x/mod/semver"
)

const (
	// golang.org/x/mod/semver *requires* a leading 'v' on versions, and will add missing minor/patch numbers.
	minimumVersion = "v1.25.3"
	// The K3s channels endpoint
	k3sChannelsEndpoint = "https://update.k3s.io/v1-release/channels"
)

type Channels struct {
	Data []Channel `json:"data"`
}
type Channel struct {
	Name   string `json:"name"`
	Latest string `json:"latest"`
}

// getK3sChannels returns a map of all non-prerelease channels, plus "latest" and "stable".
// The values are the latest release for each channel.
func getK3sChannels(ctx context.Context) (map[string]string, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, k3sChannelsEndpoint, http.NoBody)
	if err != nil {
		return nil, fmt.Errorf("failed to create HTTP request: %w", err)
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("failed to get k3s channels: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("update channel request failed with status: %s", resp.Status)
	}

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("failed to read response body for k3s update channel: %w", err)
	}

	var channels Channels
	if err := json.Unmarshal(body, &channels); err != nil {
		return nil, fmt.Errorf("failed to unmarshal response from k3s update channel: %w", err)
	}

	k3sChannels := make(map[string]string)
	for _, channel := range channels.Data {
		switch {
		case channel.Name == "latest" || channel.Name == "stable":
			// process this channel.
		case semver.Prerelease(channel.Latest) != "":
			continue
		case semver.IsValid(channel.Latest) && semver.Compare(channel.Latest, minimumVersion) >= 0:
			// process this channel.
		default:
			continue
		}
		// Turn "v1.31.3+k3s1" into "1.31.3"
		latest := strings.TrimPrefix(channel.Latest, "v")
		latest = strings.SplitN(latest, "+", 2)[0]
		k3sChannels[channel.Name] = latest
	}

	return k3sChannels, nil
}

type GithubRelease struct {
	TagName    string `json:"tag_name"`
	Draft      bool   `json:"draft"`
	Prerelease bool   `json:"prerelease"`
}

// getGithubReleasesPage fetches a single page of GitHub releases and returns a list
// of all non-draft, non-prerelease releases above the minimumVersion.
func getGithubReleasesPage(ctx context.Context, page int) ([]GithubRelease, error) {
	url := fmt.Sprintf("https://api.github.com/repos/k3s-io/k3s/releases?page=%d", page)
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, http.NoBody)
	if err != nil {
		return nil, fmt.Errorf("failed to create request for %q: %w", url, err)
	}
	token := os.Getenv("GH_TOKEN")
	if token == "" {
		token = os.Getenv("GITHUB_TOKEN")
	}
	if token != "" {
		req.Header.Set("Authorization", "token "+token)
	}

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("failed to make request for %q: %w", url, err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		//nolint:revive // error-strings
		return nil, fmt.Errorf("GitHub API request failed with status: %s", resp.Status)
	}

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("failed to read response body for %q: %w", url, err)
	}

	var releases []GithubRelease
	if err := json.Unmarshal(body, &releases); err != nil {
		return nil, fmt.Errorf("failed to unmarshal response for %q: %w", url, err)
	}

	// Filter desired releases here, so caller will stop requesting additional pages if there are
	// no more matches (heuristics, but releases are returned in reverse chronological order).
	releases = slices.DeleteFunc(releases, func(release GithubRelease) bool {
		return release.Draft || release.Prerelease || semver.Compare(release.TagName, minimumVersion) < 0
	})
	return releases, nil
}

// getGithubReleases returns a sorted list of all matching GitHub releases.
func getGithubReleases(ctx context.Context) ([]string, error) {
	releaseMap := make(map[string]string)
	for page := 1; ; page++ {
		releases, err := getGithubReleasesPage(ctx, page)
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

	return slices.SortedFunc(maps.Values(releaseMap), semver.Compare), nil
}

func getK3sVersions(ctx context.Context) (string, error) {
	k3sChannels, err := getK3sChannels(ctx)
	if err != nil {
		return "", fmt.Errorf("error fetching k3s channels: %w", err)
	}

	githubReleases, err := getGithubReleases(ctx)
	if err != nil {
		return "", fmt.Errorf("error fetching GitHub releases: %w", err)
	}

	result := map[string]any{
		"cacheVersion": 2,
		"channels":     k3sChannels,
		"versions":     githubReleases,
	}

	// json.Marshal will produce map keys in sort order
	jsonResult, err := json.MarshalIndent(result, "", "  ")
	if err != nil {
		return "", fmt.Errorf("error marshalling result to JSON: %w", err)
	}
	return string(jsonResult), nil
}

func main() {
	versions, err := getK3sVersions(context.Background())
	if err != nil {
		panic(err)
	}

	fmt.Println(versions)
}
