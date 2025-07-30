<template>
  <div class="volume-files">
    <div class="volume-info">
      <span class="volume-name">{{ volumeName }}</span>
      <badge-state
        :color="volumeExists ? 'bg-success' : 'bg-darker'"
        :label="volumeExists ? 'Available' : 'Not Found'"
      />
    </div>

    <div class="path-breadcrumb">
      <span
        class="breadcrumb-item"
        @click="navigateToPath('/')"
      >
        <i class="icon icon-folder-open" />root</span>
      <template
        v-for="(segment, index) in pathSegments"
        :key="`path-${index}`"
      >
        <span class="breadcrumb-separator">/</span>
        <span
          class="breadcrumb-item"
          :class="{ 'is-current': index === pathSegments.length - 1 }"
          @click="index < pathSegments.length - 1 ? navigateToPath(getPathUpTo(index)) : null"
        >
          {{ segment }}
        </span>
      </template>
    </div>

    <loading-indicator
      v-if="isLoading"
      class="content-state"
    >
      {{ t('volumes.files.loading') }}
    </loading-indicator>

    <banner
      v-else-if="error"
      class="content-state"
      color="error"
    >
      <span class="icon icon-info-circle icon-lg" />
      {{ error }}
    </banner>

    <div
      v-else
      class="file-browser"
    >
      <sortable-table
        :headers="headers"
        :paging="false"
        :row-actions="false"
        :rows="files"
        :search="false"
        :table-actions="false"
        class="files-table"
        key-field="path"
        no-rows-key="volumes.files.noFiles"
      >
        <template #col:name="{ row }">
          <td>
            <span
              :class="{ 'is-directory': row.isDirectory, 'is-clickable': row.isDirectory }"
              class="file-name"
              @click="row.isDirectory ? navigateToPath(row.path) : null"
            >
              <i
                :class="getFileIcon(row)"
                class="file-icon"
              />
              {{ row.name }}
            </span>
          </td>
        </template>
        <template #col:size="{ row }">
          <td>{{ row.isDirectory ? '-' : formatSize(row.size) }}</td>
        </template>
        <template #col:modified="{ row }">
          <td>{{ formatDate(row.modified) }}</td>
        </template>
        <template #col:permissions="{ row }">
          <td class="permissions">
            {{ row.permissions }}
          </td>
        </template>
      </sortable-table>
    </div>
  </div>
</template>

<script lang="ts">
import { BadgeState, Banner } from '@rancher/components';
import { defineComponent } from 'vue';
import { mapGetters } from 'vuex';

import LoadingIndicator from '@pkg/components/LoadingIndicator.vue';
import SortableTable from '@pkg/components/SortableTable';
import { ContainerEngine } from '@pkg/config/settings';
import { ipcRenderer } from '@pkg/utils/ipcRenderer';

export default defineComponent({
  name:       'VolumeFiles',
  title:      'Volume Files',
  components: {
    BadgeState,
    Banner,
    LoadingIndicator,
    SortableTable,
  },
  data() {
    return {
      settings:        undefined,
      ddClient:        null,
      isLoading:       true,
      error:           null,
      volumeExists:    false,
      currentPath:     this.$route.query.path || this.$route.query.initialPath || '/',
      files:           [],
      refreshInterval: null,
      headers:         [
        {
          name:  'name',
          label: this.t('volumes.files.table.header.name'),
          sort:  ['name'],
        },
        {
          name:  'size',
          label: this.t('volumes.files.table.header.size'),
          sort:  ['size', 'name'],
          width: 100,
        },
        {
          name:  'modified',
          label: this.t('volumes.files.table.header.modified'),
          sort:  ['modified', 'name'],
          width: 180,
        },
        {
          name:  'permissions',
          label: this.t('volumes.files.table.header.permissions'),
          sort:  ['permissions', 'name'],
          width: 120,
        },
      ],
    };
  },
  computed: {
    ...mapGetters('k8sManager', { isK8sReady: 'isReady' }),
    volumeName() {
      return this.$route.params.name || '';
    },
    isValidVolumeName() {
      const name = this.volumeName;
      return name && /^[a-zA-Z0-9._-]+$/.test(name);
    },
    hasNamespaceSelected() {
      return this.settings?.containerEngine?.name === ContainerEngine.CONTAINERD && this.settings?.containers?.namespace;
    },
    pathSegments() {
      return this.currentPath
        .split('/')
        .filter(segment => segment !== '');
    },
  },
  watch: {
    '$route.query.path': {
      async handler(newPath) {
        const path = newPath || '/';
        if (this.currentPath !== path) {
          this.currentPath = path;
          if (this.ddClient && this.volumeExists) {
            this.isLoading = true;
            try {
              await this.listFiles();
            } catch (error) {
              console.error('Error in path watcher:', error);
            }
          }
        }
      },
      immediate: false,
    },
  },
  mounted() {
    if (!this.isValidVolumeName) {
      this.error = this.t('volumes.files.invalidVolumeName', { name: this.volumeName });
      return;
    }

    this.$store.dispatch('page/setHeader', {
      title:       this.t('volumes.files.title'),
      description: this.volumeName,
    });

    ipcRenderer.on('settings-read', this.onSettingsRead);
    ipcRenderer.send('settings-read');

    this.refreshInterval = setInterval(() => {
      if (!this.isLoading && this.volumeExists) {
        this.listFiles();
      }
    }, 30000);
  },
  beforeUnmount() {
    ipcRenderer.off('settings-read', this.onSettingsRead);
    if (this.refreshInterval) {
      clearInterval(this.refreshInterval);
    }
  },
  methods: {
    async onSettingsRead(event, settings) {
      this.settings = settings;
      await this.initializeFileBrowser();
    },
    async initializeFileBrowser() {
      if (window.ddClient && this.isK8sReady && this.settings) {
        this.ddClient = window.ddClient;
        await this.checkVolumeExists();
        if (this.volumeExists) {
          await this.listFiles();
        }
      }
    },
    async checkVolumeExists() {
      try {
        const options = {};
        if (this.hasNamespaceSelected) {
          options.namespace = this.hasNamespaceSelected;
        }

        const volumes = await this.ddClient?.docker.rdListVolumes(options);
        this.volumeExists = volumes?.some(v => v.Name === this.volumeName) || false;

        if (!this.volumeExists) {
          this.error = this.t('volumes.files.volumeNotFound', { name: this.volumeName });
        }
      } catch (error) {
        console.error('Error checking volume:', error);
        this.volumeExists = false;
        this.error = this.t('volumes.files.checkError');
      }
    },
    async listFiles() {
      try {
        this.error = null;

        const containerPath = `/volume${ this.currentPath }`;
        const lsCommand = [
          'run', '--rm', '--quiet',
          '-v', `${ this.volumeName }:/volume:ro`,
          'busybox',
          'ls', '-la', '--full-time', '--group-directories-first',
          containerPath,
        ];

        const execOptions = { cwd: '/' };
        if (this.hasNamespaceSelected) {
          execOptions.namespace = this.hasNamespaceSelected;
        }

        const { stderr, stdout } = await this.ddClient.docker.cli.exec(
          lsCommand[0],
          lsCommand.slice(1),
          execOptions,
        );

        if (stderr && !stderr.includes('level=warning')) {
          throw new Error(stderr);
        }

        this.files = this.parseLsOutput(stdout);
        this.isLoading = false;
      } catch (error) {
        const errorSources = [
          error?.message,
          error?.stderr,
          error?.error,
          typeof error === 'string' ? error : null,
          'Failed to list files',
        ];

        console.error('Error listing files:', error);
        this.error = this.t('volumes.files.listError', { error: errorSources.find(msg => msg) });
        this.isLoading = false;
      }
    },
    parseLsOutput(output) {
      const lines = output.trim().split('\n').filter(line => line.trim());
      const files = [];

      for (const line of lines) {
        // Skip the "total" line
        if (line.startsWith('total ')) {
          continue;
        }
        const match = line.match(/^(?<permissions>[drwxst-]+)\s+(?<links>\d+)\s+(?<owner>\S+)\s+(?<group>\S+)\s+(?<size>\d+)\s+(?<date>\d{4}-\d{2}-\d{2})\s+(?<time>\d{2}:\d{2}:\d{2})\s+(?<timezone>[+-]\d{4})\s+(?<name>.+)$/);
        if (match?.groups) {
          const { permissions, owner, group, size, date, time, name } = match.groups;

          if (name === '.' || name === '..') {
            continue;
          }

          const isDirectory = permissions.startsWith('d');
          const path = this.currentPath === '/'
            ? `/${ name }`
            : `${ this.currentPath }/${ name }`;

          const modified = new Date(`${ date }T${ time }`);

          files.push({
            name,
            path,
            permissions,
            owner,
            group,
            size: parseInt(size, 10),
            modified,
            isDirectory,
          });
        }
      }

      return files;
    },
    navigateToPath(path) {
      if (this.currentPath === path) {
        return;
      }

      // Use router to create history entry for directory navigation
      this.$router.push({
        name:   'volumes-files-name',
        params: { name: this.volumeName },
        query:  { path },
      }).catch(err => {
        if (err.name !== 'NavigationDuplicated') {
          console.error('Navigation error:', err);
        }
      });
    },
    getPathUpTo(index) {
      const segments = this.pathSegments.slice(0, index + 1);
      return '/' + segments.join('/');
    },
    getFileIcon(file) {
      if (file.isDirectory) {
        return 'icon icon-folder';
      }

      return 'icon icon-file';
    },
    formatSize(bytes) {
      if (bytes === 0) return '0 B';
      const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
      const i = Math.floor(Math.log(bytes) / Math.log(1024));
      return Math.round(bytes / Math.pow(1024, i) * 100) / 100 + ' ' + sizes[i];
    },
    formatDate(date) {
      return date.toLocaleString();
    },
  },
});
</script>

<style lang="scss" scoped>
.volume-files {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 1rem;
  padding: 1.25rem;
  overflow: hidden;
  min-height: 0;
  height: 100%;
}

.volume-info {
  display: flex;
  align-items: center;
  gap: 0.625rem;
  padding-left: 0.625rem;

  .volume-name {
    font-family: monospace;
    font-weight: bold;
    color: var(--primary);
  }
}

.path-breadcrumb {
  display: flex;
  align-items: center;
  gap: 0.25rem;
  padding: 0.5rem 0.625rem;
  background: var(--nav-bg);
  border: 1px solid var(--border);
  border-radius: var(--border-radius);
  font-family: monospace;
  font-size: 0.875rem;
  overflow-x: auto;

  .breadcrumb-item {
    color: var(--link);
    cursor: pointer;
    white-space: nowrap;

    &:hover:not(.is-current) {
      color: var(--link-hover);
      text-decoration: underline;
    }

    &.is-current {
      color: var(--body-text);
      cursor: default;
      font-weight: 500;
    }

    .icon {
      margin-right: 0.25rem;
    }
  }

  .breadcrumb-separator {
    color: var(--muted);
    user-select: none;
  }
}

.content-state {
  display: flex;
  justify-content: center;
  align-items: center;
  padding: 2.5rem;
  flex: 1;
}

.file-browser {
  flex: 1;
  overflow: auto;
  display: flex;
  flex-direction: column;
  min-height: 0;
}

.file-name {
  display: flex;
  align-items: center;
  gap: 0.5rem;

  &.is-directory {
    color: var(--link);
    font-weight: 500;
  }

  &.is-clickable {
    cursor: pointer;

    &:hover {
      color: var(--link-hover);
      text-decoration: underline;
    }
  }
}

.file-icon {
  font-size: 1rem;
  color: var(--muted);

  .is-directory & {
    color: var(--warning);
  }
}

.permissions {
  font-family: monospace;
  font-size: 0.875rem;
  color: var(--muted);
}

.files-table {
  flex: 1;
  overflow: auto;
  min-height: 0;
}

.files-table::v-deep .sortable-table-header {
  position: sticky;
  top: 0;
  background: var(--body-bg);
  z-index: 1;
}

.files-table::v-deep tbody {
  overflow-y: auto;
}
</style>
