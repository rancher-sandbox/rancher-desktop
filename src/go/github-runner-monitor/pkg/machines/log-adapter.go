/*
Copyright © 2023 SUSE LLC

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
*/

package machines

import (
	"github.com/sirupsen/logrus"
)

// LogAdapter adapts a *logrus.Entry to a QMPLog.
type LogAdapter struct {
	*logrus.Entry
}

// V returns true if the given argument is less than or equal
// to the implementation's defined verbosity level.
func (l *LogAdapter) V(level int32) bool {
	return l.Logger.IsLevelEnabled(logrus.Level(level))
}
