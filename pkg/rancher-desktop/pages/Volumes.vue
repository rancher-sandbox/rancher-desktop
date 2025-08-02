<template>
  <div class="volumes">
    <banner
      v-if="error"
      color="error"
      data-testid="error-banner"
      @close="error = null"
    >
      {{ error }}
    </banner>
    <SortableTable
      class="volumesTable"
      data-testid="volumes-table"
      :headers="headers"
      key-field="Name"
      :rows="rows"
      no-rows-key="volumes.sortableTables.noRows"
      :row-actions="true"
      :paging="true"
      :rows-per-page="10"
      :has-advanced-filtering="false"
      :loading="!volumes"
    >
      <template #header-middle>
        <div class="header-middle">
          <div v-if="supportsNamespaces">
            <label>Namespace</label>
            <select
              :value="namespace"
              class="select-namespace"
              data-testid="namespace-selector"
              @change="onChangeNamespace($event)"
            >
              <option
                v-for="item in namespaces ?? []"
                :key="item"
                :selected="item === namespace"
                :value="item"
              >
                {{ item }}
              </option>
            </select>
          </div>
        </div>
      </template>
      <template #col:Name="{ row } : { row: RowItem }">
        <td data-testid="volume-name-cell">
          <span v-tooltip="getTooltipConfig(row.Name)">
            {{ shortSha(row.Name) }}
          </span>
        </td>
      </template>
      <template #col:Driver="{ row } : { row: RowItem }">
        <td data-testid="volume-driver-cell">
          {{ row.Driver }}
        </td>
      </template>
      <template #col:Mountpoint="{ row } : { row: RowItem }">
        <td data-testid="volume-mountpoint-cell">
          <span v-tooltip="getTooltipConfig(row.Mountpoint)">
            {{ shortPath(row.Mountpoint) }}
          </span>
        </td>
      </template>
      <template #col:Created="{ row } : { row: RowItem }">
        <td data-testid="volume-created-cell">
          {{ row.createdText }} <!-- use the text representation -->
        </td>
      </template>
    </SortableTable>
  </div>
</template>

<script lang="ts">
import { Banner } from '@rancher/components';
import merge from 'lodash/merge';
import { defineComponent } from 'vue';
import { mapGetters } from 'vuex';

import SortableTable from '@pkg/components/SortableTable';
import type { Settings } from '@pkg/config/settings';
import { mapTypedGetters, mapTypedState } from '@pkg/entry/store';
import type { Volume } from '@pkg/store/container-engine';
import { ipcRenderer } from '@pkg/utils/ipcRenderer';

const MAX_PATH_LENGTH = 40;

/**
 * The RowItem type describes the type of one row.
 */
interface RowItem extends Volume {
  createdText:      string;
  availableActions: {
    label:       string;
    action:      string;
    enabled:     boolean;
    bulkable:    boolean;
    bulkAction?: string;
  }[];
  deleteVolume: (items?: RowItem[]) => void;
  browseFiles:  (items?: RowItem[]) => void;
}

export default defineComponent({
  name:       'Volumes',
  title:      'Volumes',
  components: { SortableTable, Banner },
  data() {
    return {
      settings:       undefined as Settings | undefined,
      subscribeTimer: undefined as ReturnType<typeof setTimeout> | undefined,
      error:          null,
      headers:        [
        {
          name:  'Name',
          label: this.t('volumes.manage.table.header.volumeName'),
          sort:  ['Name'],
        },
        {
          name:  'Driver',
          label: this.t('volumes.manage.table.header.driver'),
          sort:  ['Driver', 'Name'],
        },
        {
          name:  'Mountpoint',
          label: this.t('volumes.manage.table.header.mountpoint'),
          sort:  ['Mountpoint', 'Name'],
        },
        {
          name:  'Created',
          label: this.t('volumes.manage.table.header.created'),
          sort:  ['Created', 'Name'],
          width: 120,
        },
      ],
    };
  },
  computed: {
    ...mapGetters('k8sManager', { isK8sReady: 'isReady' }),
    ...mapTypedState('container-engine', ['namespaces', 'volumes']),
    ...mapTypedGetters('container-engine', ['namespace', 'supportsNamespaces']),
    rows(): RowItem[] {
      return Object.values(this.volumes ?? {})
        .sort((a, b) => a.Name.localeCompare(b.Name))
        .map(volume => merge({}, volume, {
          createdText:          volume.CreatedAt ? new Date(volume.CreatedAt).toLocaleDateString() : '',
          availableActions: [
            {
              label:    this.t('volumes.manager.table.action.browse'),
              action:   'browseFiles',
              enabled:  true,
              bulkable: false,
            },
            {
              label:      this.t('volumes.manager.table.action.delete'),
              action:     'deleteVolume',
              enabled:    true,
              bulkable:   true,
              bulkAction: 'deleteVolume',
            },
          ],
          deleteVolume: (args?: Volume[]) => {
            this.execCommand(['volume', 'rm'], Array.isArray(args) ? args : [volume]);
          },
          browseFiles: () => {
            this.$router.push({ name: 'volumes-files-name', params: { name: volume.Name } });
          },
        }));
    },
  },
  mounted() {
    this.$store.dispatch('page/setHeader', {
      title:       this.t('volumes.title'),
      description: '',
    });

    ipcRenderer.on('settings-read', (event, settings) => {
      this.settings = settings;
      this.subscribe().catch(console.error);
    });

    ipcRenderer.send('settings-read');

    ipcRenderer.on('settings-update', (_event, settings) => {
      this.settings = settings;
      this.checkSelectedNamespace();
    });

    this.subscribe().catch(console.error);
  },
  beforeUnmount() {
    this.$store.dispatch('container-engine/unsubscribe');
    clearTimeout(this.subscribeTimer);
  },
  methods: {
    async subscribe() {
      clearTimeout(this.subscribeTimer);
      try {
        if (!window.ddClient || !this.isK8sReady || !this.settings) {
          setTimeout(() => this.subscribe(), 1_000);
          return;
        }
        await this.$store.dispatch('container-engine/subscribe', {
          type:      'volumes',
          client:    window.ddClient,
        });
      } catch (error) {
        console.error('There was a problem subscribing to container events:', { error });
      }
    },
    checkSelectedNamespace() {
      if (!this.supportsNamespaces || !this.namespaces?.length) {
        return;
      }
      if (!this.namespaces.includes(this.namespace ?? '')) {
        const K8S_NAMESPACE = 'k8s.io';
        const defaultNamespace = this.namespaces.includes(K8S_NAMESPACE) ? K8S_NAMESPACE : this.namespaces[0];

        ipcRenderer.invoke('settings-write',
          { containers: { namespace: defaultNamespace } });
      }
    },
    async onChangeNamespace(event: Event) {
      const { value } = event.target as HTMLSelectElement;
      if (value !== this.namespace) {
        await ipcRenderer.invoke('settings-write',
          { containers: { namespace: value } });
        await this.$store.dispatch('container-engine/subscribe', {
          type:      'volumes',
          client:    window.ddClient,
          namespace: value,
        });
      }
    },
    async execCommand(args: string[], volumes: Volume[]) {
      try {
        const names = volumes.map(v => v.Name);
        const [baseCommand, ...subCommands] = args;

        console.info(`Executing command ${ args.join(' ') } on volume ${ names }`);

        const execOptions: { cwd: string, namespace?: string } = { cwd: '/' };
        if (this.supportsNamespaces && this.namespace) {
          execOptions.namespace = this.namespace;
        }

        const { stderr, stdout } = await window.ddClient.docker.cli.exec(
          baseCommand,
          [...subCommands, ...names],
          execOptions,
        );

        if (stderr) {
          throw new Error(stderr);
        }

        await this.$store.dispatch('container-engine/fetchVolumes');

        return stdout;
      } catch (error: any) {
        const errorSources = [
          error?.message,
          error?.stderr,
          error?.error,
          typeof error === 'string' ? error : null,
          `Failed to execute command: ${ args.join(' ') }`,
        ];

        this.error = errorSources.find(msg => msg);
        console.error(`Error executing command ${ args.join(' ') }`, error);
      }
    },
    shortSha(sha: string) {
      if (!sha?.startsWith('sha256:')) return sha || '';

      const hash = sha.replace('sha256:', '');
      return `sha256:${ hash.slice(0, 3) }..${ hash.slice(-3) }`;
    },
    shortPath(path: string) {
      if (!path || path.length <= MAX_PATH_LENGTH) {
        return path || '';
      }

      return `${ path.slice(0, 20) }...${ path.slice(-17) }`;
    },
    getTooltipConfig(text: string) {
      if (!text) {
        return { content: undefined };
      }

      // Show tooltip for sha256 hashes or long paths
      if (text.startsWith('sha256:') || text.length > MAX_PATH_LENGTH) {
        return { content: text };
      }

      return { content: undefined };
    },
  },
});
</script>

<style lang="scss" scoped>
.volumes {
  &-status {
    padding: 8px 5px;
  }
}

.select-namespace {
  max-width: 24rem;
  min-width: 8rem;
}

.volumesTable:v-deep(.search-box) {
  align-self: flex-end;
}
.volumesTable:v-deep(.bulk) {
  align-self: flex-end;
}
</style>
