package dcnone

import (
	"errors"
	"testing"

	"github.com/docker/docker-credential-helpers/credentials"
)

func TestDCNoneHelper(t *testing.T) {
	helper := DCNone{}

	const server1 = "https://foobar.docker.io:2376/v1"
	const server2 = "https://foobar.docker.io:9999/v2"
	sawServers := map[string]bool{
		server1: false,
		server2: false,
	}
	creds := &credentials.Credentials{
		ServerURL: server1,
		Username:  "nothing",
		Secret:    "isthebestmeshuggahalbum",
	}

	helper.Add(creds)

	creds.ServerURL = server2
	helper.Add(creds)

	credsList, err := helper.List()
	if err != nil {
		t.Fatal(err)
	}

	for server, username := range credsList {
		if server == server1 {
			sawServers[server] = true
		} else if server == server2 {
			sawServers[server] = true
		} else {
			continue
		}

		if username != "nothing" {
			t.Fatalf("invalid username: %v", username)
		}

		u, s, err := helper.Get(server)
		if err != nil {
			t.Fatal(err)
		}

		if u != username {
			t.Fatalf("invalid username %s", u)
		}

		if s != "isthebestmeshuggahalbum" {
			t.Fatalf("invalid secret: %s", s)
		}

		err = helper.Delete(server)
		if err != nil {
			t.Fatal(err)
		}

		username, _, err = helper.Get(server)
		if err == nil {
			t.Fatalf("Not an error trying to find deleted serverURL %s", server)
		}
		if !errors.Is(err, credentials.NewErrCredentialsNotFound()) {
			t.Fatalf("Trying to search delete URL %s should give error %s, gave error %s", server, credentials.NewErrCredentialsNotFound(), err)
		}

		if username != "" {
			t.Fatalf("%s shouldn't exist any more", username)
		}
	}
	for serverURL, processed := range sawServers {
		if !processed {
			t.Fatalf("Failed to store server %s", serverURL)
		}
	}

	credsList, err = helper.List()
	if err != nil {
		t.Fatal(err)
	}
	for server := range credsList {
		_, ok := sawServers[server]
		if ok {
			t.Fatalf("Failed to delete server %s", server)
		}
	}
}
