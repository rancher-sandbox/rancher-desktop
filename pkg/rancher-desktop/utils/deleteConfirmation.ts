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

import { ipcRenderer } from '@pkg/utils/ipcRenderer';

export interface DeleteConfirmationOptions {
  /** The dialog title. */
  title:   string;
  /** The question, with the count already filled in. */
  message: string;
  /** Label of the button that deletes, including its access key. */
  confirm: string;
  /** Label of the button that cancels. */
  cancel:  string;
  /** Names of the items to delete, listed one per line under the question. */
  names:   string[];
}

/**
 * Ask the user to confirm deleting the named items. Cancel is both the default
 * button and the escape route, so dismissing the dialog deletes nothing.
 * @returns Whether the user chose to delete them.
 */
export async function showDeleteConfirmation(options: DeleteConfirmationOptions): Promise<boolean> {
  const acceptId = 0;
  const cancelId = 1;
  const result = await ipcRenderer.invoke('show-message-box', {
    type:    'question',
    title:   options.title,
    message: options.message,
    detail:  options.names.join('\n'),
    buttons: Object.assign([], {
      [acceptId]: options.confirm,
      [cancelId]: options.cancel,
    }),
    defaultId:           cancelId,
    cancelId,
    normalizeAccessKeys: true,
  });

  return result.response !== cancelId;
}
