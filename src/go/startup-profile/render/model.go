package render

import "time"

type nodeId int64

// https://chromedevtools.github.io/devtools-protocol/1-3/Profiler/#type-Profile
// This is the root object of the document.
type profile struct {
	Nodes      []*profileNode `json:"nodes"`
	StartTime  int64          `json:"startTime"`
	EndTime    int64          `json:"endTime"`
	Samples    []nodeId       `json:"samples"`
	TimeDeltas []int64        `json:"timeDeltas"`
}

// https://chromedevtools.github.io/devtools-protocol/1-3/Profiler/#type-ProfileNode
type profileNode struct {
	Id        nodeId        `json:"id"`
	CallFrame callFrame     `json:"callFrame"`
	Children  []nodeId      `json:"children,omitempty"`
	StartTime time.Time     `json:"-startTime"`
	StopTime  time.Time     `json:"-stopTime"`
	Duration  time.Duration `json:"-duration"`
}

// https://chromedevtools.github.io/devtools-protocol/1-3/Runtime/#type-CallFrame
type callFrame struct {
	FunctionName string `json:"functionName"`
	ScriptId     string `json:"scriptId"`
	Url          string `json:"url"`
	LineNumber   int64  `json:"lineNumber"`
	ColumnNumber int64  `json:"columnNumber"`
}
