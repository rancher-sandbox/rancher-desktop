<script lang="ts">
import Vue, { PropType } from 'vue';

import SortableTable from '@pkg/components/SortableTable/index.vue';
import type { ServerState } from '@pkg/main/commandServer/httpCommandServer';
import { ExtensionMetadata } from '@pkg/main/extensions/types';
import { ipcRenderer } from '@pkg/utils/ipcRenderer';

export default Vue.extend({
  name:       'extensions-installed',
  components: { SortableTable },
  props:      {
    credentials: {
      type:     Object as PropType<Omit<ServerState, 'pid'>>,
      required: true,
    },
  },
  data() {
    return {
      extensions: [] as { id: string; metadata: ExtensionMetadata; }[],
      headers:    [
        {
          name:  'id',
          label: 'Name',
        },
        {
          name:  'uninstall',
          label: ' ',
          width: 76,
        },
      ],
    };
  },
  beforeMount() {
    ipcRenderer.on('extensions/list', (_event, extensions) => {
      this.extensions = extensions || [];
    });
    ipcRenderer.send('extensions/list');
  },
  methods: {
    uninstall(id: string) {
      fetch(
        `http://localhost:${ this.credentials?.port }/v1/extensions/uninstall?id=${ id }`,
        {
          method:  'POST',
          headers: new Headers({
            Authorization: `Basic ${ window.btoa(
              `${ this.credentials?.user }:${ this.credentials?.password }`,
            ) }`,
            'Content-Type': 'application/x-www-form-urlencoded',
          }),
        },
      );
    },
  },
});
</script>

<template>
  <div>
    <sortable-table
      key-field="description"
      :headers="headers"
      :rows="extensions"
      :search="false"
      :table-actions="false"
      :row-actions="false"
    >
      <template #col:uninstall="{row}">
        <td>
          <button
            class="btn btn-sm role-primary"
            @click="uninstall(row.id)"
          >
            Uninstall
          </button>
        </td>
      </template>
    </sortable-table>
  </div>
</template>
