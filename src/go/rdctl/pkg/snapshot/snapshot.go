package snapshot

import (
	"encoding/json"
	"time"
)

type Snapshot struct {
	Created     time.Time `json:"created"`
	Name        string    `json:"name"`
	ID          string    `json:"id,omitempty"`
	Description string    `json:"description"`
}

func (s *Snapshot) getTimeString() string {
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
