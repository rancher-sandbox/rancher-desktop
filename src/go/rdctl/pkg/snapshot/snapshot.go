package snapshot

import (
	"time"
)

type Snapshot struct {
	Created time.Time
	Name    string
	ID      string
}
