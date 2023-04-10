<script lang="ts">
import Vue, { PropType } from 'vue';

import EmptyState from '@pkg/components/EmptyState.vue';
import SortableTable from '@pkg/components/SortableTable/index.vue';
import type { ServerState } from '@pkg/main/commandServer/httpCommandServer';
import { ExtensionMetadata } from '@pkg/main/extensions/types';
import { ipcRenderer } from '@pkg/utils/ipcRenderer';

export default Vue.extend({
  name:       'extensions-installed',
  components: { SortableTable, EmptyState },
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
      loading: true,
    };
  },
  computed: {
    emptyStateIcon(): string {
      return this.t('extensions.installed.emptyState.icon');
    },
    emptyStateHeading(): string {
      return this.t('extensions.installed.emptyState.heading');
    },
    emptyStateBody(): string {
      return this.t('extensions.installed.emptyState.body', { }, true);
    },
  },
  beforeMount() {
    ipcRenderer.on('extensions/list', (_event, extensions) => {
      this.extensions = extensions || [];
      this.loading = false;
    });
    ipcRenderer.send('extensions/list');
  },
  methods: {
    browseExtensions() {
      this.$emit('click:browse');
    },
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
      :loading="loading"
      :headers="headers"
      :rows="extensions"
      :search="false"
      :table-actions="false"
      :row-actions="false"
    >
      <template #no-rows>
        <td :colspan="headers.length + 1">
          <empty-state
            :icon="emptyStateIcon"
            :heading="emptyStateHeading"
            :body="emptyStateBody"
          >
            <template #primary-action>
              <button
                class="btn role-primary"
                @click="browseExtensions"
              >
                {{ t('extensions.installed.emptyState.button.text') }}
              </button>
            </template>
          </empty-state>
        </td>
      </template>
      <template #col:id="{row}">
        <td>
          <nuxt-link
            :to="{
              name: 'marketplace-details',
              params: {
                slug: row.id,
                image: row.metadata.icon
              }
            }"
          >
            {{ row.metadata.ui['dashboard-tab'].title }}
          </nuxt-link>
        </td>
      </template>
      <template #col:uninstall="{row}">
        <td>
          <button
            class="btn btn-sm role-primary"
            @click="uninstall(row.id)"
          >
            {{ t('extensions.installed.list.uninstall') }}
          </button>
        </td>
      </template>
    </sortable-table>
  </div>
</template>
