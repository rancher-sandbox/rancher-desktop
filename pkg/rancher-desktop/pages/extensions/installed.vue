<script lang="ts">
import { defineComponent } from 'vue';
import { mapGetters } from 'vuex';

import EmptyState from '@pkg/components/EmptyState.vue';
import LoadingIndicator from '@pkg/components/LoadingIndicator.vue';
import NavIconExtension from '@pkg/components/NavIconExtension.vue';
import SortableTable from '@pkg/components/SortableTable/index.vue';
import useCredentials from '@pkg/hocs/withCredentials';
import type { ExtensionState } from '@pkg/store/extensions';
import { ipcRenderer } from '@pkg/utils/ipcRenderer';

type InstalledExtensionRow = ExtensionState & {
  title:       string;
  vendor:      string;
  description: string;
  moreInfo:    string;
};

interface ExtensionMetadataSource {
  id:      string;
  labels?: Record<string, string>;
}

const LABEL_TITLE = 'org.opencontainers.image.title';
const LABEL_VENDOR = 'org.opencontainers.image.vendor';
const LABEL_DESCRIPTION = 'org.opencontainers.image.description';
const LABEL_MORE_INFO = 'io.rancherdesktop.extension.more-info';

export default defineComponent({
  name:       'extensions-installed',
  components: {
    LoadingIndicator, NavIconExtension, SortableTable, EmptyState,
  },
  setup() {
    useCredentials();
  },
  data() {
    return {
      headers: [
        {
          name:  'icon',
          label: ' ',
          width: 35,
        },
        {
          name:  'title',
          label: 'Name',
          sort:  ['title', 'id'],
        },
        {
          name:  'vendor',
          label: 'Vendor',
          sort:  ['vendor', 'title', 'id'],
          width: 160,
        },
        {
          name:  'description',
          label: 'Description',
          sort:  ['description', 'title', 'id'],
        },
        {
          name:  'moreInfo',
          label: 'More information',
          width: 150,
        },
        {
          name:  'actions',
          label: ' ',
          width: 170,
        },
      ],
      loading: true,
      busy:    {} as Record<string, boolean>,
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
    installedExtensionRows(): InstalledExtensionRow[] {
      return this.installedExtensions.map(extension => ({
        ...extension,
        title:       this.extensionTitle(extension),
        vendor:      this.extensionVendor(extension),
        description: this.extensionDescription(extension),
        moreInfo:    this.extensionLink(extension),
      }));
    },
    ...mapGetters('extensions', ['installedExtensions']) as {
      installedExtensions: () => ExtensionState[],
    },
  },
  async beforeMount() {
    ipcRenderer.on('extensions/changed', () => {
      this.$store.dispatch('extensions/fetch');
    });
    await this.$store.dispatch('extensions/fetch');
    this.loading = false;
  },
  methods: {
    extensionLabel(ext: { labels?: Record<string, string> }, label: string, fallback = ''): string {
      return ext.labels?.[label]?.trim() || fallback;
    },
    extensionTitle(ext: ExtensionMetadataSource): string {
      return this.extensionLabel(ext, LABEL_TITLE, ext.id);
    },
    extensionVendor(ext: { labels?: Record<string, string> }): string {
      return this.extensionLabel(ext, LABEL_VENDOR);
    },
    extensionDescription(ext: { labels?: Record<string, string> }): string {
      return this.extensionLabel(ext, LABEL_DESCRIPTION);
    },
    extensionLink(ext: ExtensionMetadataSource): string {
      const preferredURL = this.extensionLabel(ext, LABEL_MORE_INFO);

      if (preferredURL) {
        return preferredURL;
      }

      if (!/^[^./]+\//.test(ext.id)) {
        return `https://${ ext.id }`;
      }

      return `https://hub.docker.com/extensions/${ ext.id }`;
    },
    browseExtensions() {
      this.$emit('click:browse');
    },
    async uninstall(installed: ExtensionState) {
      this.busy = { ...this.busy, [installed.id]: true };
      try {
        await this.$store.dispatch('extensions/uninstall', { id: installed.id });
      } finally {
        const { [installed.id]: _, ...rest } = this.busy;

        this.busy = rest;
      }
    },
    async upgrade(installed: ExtensionState) {
      const id = `${ installed.id }:${ installed.availableVersion }`;

      if (!installed.availableVersion) {
        // Should not have reached here.
        return;
      }
      this.busy = { ...this.busy, [installed.id]: true };
      try {
        await this.$store.dispatch('extensions/install', { id });
      } finally {
        const { [installed.id]: _, ...rest } = this.busy;

        this.busy = rest;
      }
    },
  },
});
</script>

<template>
  <div>
    <sortable-table
      key-field="id"
      :loading="loading"
      :headers="headers"
      :rows="installedExtensionRows"
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
      <template #col:icon="{ row }">
        <td>
          <nav-icon-extension :extension-id="row.id" />
        </td>
      </template>
      <template #col:title="{ row }">
        <td>
          {{ row.title }}
        </td>
      </template>
      <template #col:vendor="{ row }">
        <td>
          <span v-if="row.vendor">{{ row.vendor }}</span>
          <span
            v-else
            class="empty-cell"
          >-</span>
        </td>
      </template>
      <template #col:description="{ row }">
        <td class="description">
          <span v-if="row.description">{{ row.description }}</span>
          <span
            v-else
            class="empty-cell"
          >-</span>
        </td>
      </template>
      <template #col:moreInfo="{ row }">
        <td>
          <a
            class="more-info-link"
            :href="row.moreInfo"
            :title="row.moreInfo"
            target="_blank"
            rel="noopener noreferrer"
          >
            {{ t('marketplace.moreInfo') }}
            <i class="icon icon-external-link" />
          </a>
        </td>
      </template>
      <template #col:actions="{ row }">
        <td>
          <div class="actions">
            <span
              v-if="busy[row.id]"
              name="busy"
              :is-loading="busy"
            >
              <loading-indicator />
            </span>
            <button
              v-if="!busy[row.id] && row.canUpgrade"
              class="btn btn-sm role-primary"
              @click.stop="upgrade(row)"
            >
              {{ t('extensions.installed.list.upgrade') }}
            </button>
            <button
              :disabled="busy[row.id]"
              class="btn btn-sm role-danger"
              @click.stop="uninstall(row)"
            >
              {{ t('extensions.installed.list.uninstall') }}
            </button>
          </div>
        </td>
      </template>
    </sortable-table>
  </div>
</template>

<style lang="scss" scoped>
.actions {
  display: flex;
  flex-direction: row;
  align-items: center;
  justify-content: end;
  & > * {
    margin-left: 10px;
  }
}

.description {
  line-height: 1.35;
  white-space: normal;
}

.empty-cell {
  color: var(--muted);
}

.more-info-link {
  white-space: nowrap;
}
</style>
