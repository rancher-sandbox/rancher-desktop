/*
Copyright © 2026 SUSE LLC

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

/**
 * Remove an access key written in parentheses after the label, as Chinese,
 * Japanese and Korean translations write it. "削除(&D)" becomes "削除".
 * Translations write the half-width pair; a full-width pair matches too, so
 * converting them in a typography pass keeps the mnemonic working.
 */
export function removeParenthesizedAccessKey(label: string): string {
  return label.replace(/[(（]&[^&][)）]/g, '');
}
