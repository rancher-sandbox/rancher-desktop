package snapshot

import (
	"encoding/json"
	"time"
)

type Snapshot struct {
	Created time.Time `json:"created"`
	Name    string    `json:"name"`
	ID      string
}

var OutputUTCTime bool

func (s *Snapshot) getTimeString() string {
	if OutputUTCTime {
		return s.Created.UTC().Format(time.RFC3339)
	}
	return s.Created.Format(time.RFC3339)
}

func (s *Snapshot) MarshalJSON() ([]byte, error) {
	type Alias Snapshot
	return json.Marshal(&struct {
		*Alias
		Created string `json:"created"`
	}{
		Alias:   (*Alias)(s),
		Created: s.getTimeString(),
	})
}
