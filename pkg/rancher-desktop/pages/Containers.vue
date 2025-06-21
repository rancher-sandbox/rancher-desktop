<template>
  <div class="containers">
    <SortableTable
      ref="sortableTableRef"
      class="containersTable"
      :headers="headers"
      key-field="Id"
      :rows="rows"
      no-rows-key="containers.sortableTables.noRows"
      :row-actions="true"
      :paging="true"
      :rows-per-page="10"
      :has-advanced-filtering="false"
      :loading="!containersList"
    >
      <template #header-middle>
        <div class="header-middle">
          <div v-if="supportsNamespaces">
            <label>Namespace</label>
            <select
              class="select-namespace"
              :value="selectedNamespace"
              @change="onChangeNamespace($event)"
            >
              <option
                v-for="item in containersNamespaces"
                :key="item"
                :value="item"
                :selected="item === selectedNamespace"
              >
                {{ item }}
              </option>
            </select>
          </div>
        </div>
      </template>
      <template #col:containerState="{row}">
        <td>
          <badge-state
            :color="isRunning(row) ? 'bg-success' : 'bg-darker'"
            :label="row.State"
          />
        </td>
      </template>
      <template #col:imageName="{row}">
        <td>
          <span v-tooltip="getTooltipConfig(row.imageName)">
            {{ shortSha(row.imageName) }}
          </span>
        </td>
      </template>
      <template #col:containerName="{row}">
        <td>
          <span v-tooltip="getTooltipConfig(row.containerName)">
            {{ shortSha(row.containerName) }}
          </span>
        </td>
      </template>
      <template #col:ports="{ row }">
        <td>
          <div class="port-container">
            <a
              v-for="port in getUniquePorts(row.Ports).slice(0, 2)"
              :key="port"
              target="_blank"
              class="link"
              @click="openUrl(port)"
            >
              {{ port }}
            </a>

            <div
              v-if="shouldHaveDropdown(row.Ports)"
              class="dropdown"
              @mouseenter="addDropDownPosition"
              @mouseleave="clearDropDownPosition"
            >
              <span>
                ...
              </span>
              <div class="dropdown-content">
                <a
                  v-for="port in getUniquePorts(row.Ports).slice(2)"
                  :key="port"
                  target="_blank"
                  class="link"
                  @click="openUrl(port)"
                >
                  {{ port }}
                </a>
              </div>
            </div>
          </div>
        </td>
      </template>
    </SortableTable>
  </div>
</template>

<script>
import { BadgeState } from '@rancher/components';
import { shell } from 'electron';
import { defineComponent } from 'vue';
import { mapGetters } from 'vuex';

import SortableTable from '@pkg/components/SortableTable';
import { ContainerEngine } from '@pkg/config/settings';
import { ipcRenderer } from '@pkg/utils/ipcRenderer';

let containerCheckInterval = null;

/**
 * @typedef Container {Object} The return type of ddClient.docker.listContainers
 * @property Id {string} The container id
 */

export default defineComponent({
  name:       'containers',
  title:      'Containers',
  components: { SortableTable, BadgeState },
  data() {
    return {
      /** @type import('@pkg/config/settings').Settings | undefined */
      settings:             undefined,
      ddClient:             null,
      containersList:       null,
      showRunning:          false,
      containersNamespaces: [],
      headers:              [
        // INFO: Disable for now since we can only get the running containers.
        {
          name:  'containerState',
          label: this.t('containers.manage.table.header.state'),
        },
        {
          name:  'containerName',
          label: this.t('containers.manage.table.header.containerName'),
          sort:  ['containerName', 'image', 'imageName'],
        },
        {
          name:  'imageName',
          label: this.t('containers.manage.table.header.image'),
          sort:  ['imageName', 'containerName', 'imageName'],
        },
        {
          name:  'ports',
          label: this.t('containers.manage.table.header.ports'),
          sort:  ['ports', 'containerName', 'imageName'],
        },
        {
          name:  'started',
          label: this.t('containers.manage.table.header.started'),
          sort:  ['si', 'containerName', 'imageName'],
          width: 120,
        },
      ],
    };
  },
  computed: {
    ...mapGetters('k8sManager', { isK8sReady: 'isReady' }),
    rows() {
      if (!this.containersList) {
        return [];
      }

      // `this.containersList` is a Proxy; so we can't use structedClone.
      const containers = JSON.parse(JSON.stringify(this.containersList));

      return containers.map((container) => {
        const names = Array.isArray(container.Names) ? container.Names : container.Names.split(/\s+/);
        const name = names[0];

        container.state = container.State;
        container.containerName = name.replace(
          /_[a-z0-9-]{36}_[0-9]+/,
          '',
        );
        container.started = container.State === 'running' ? container.Status : '';
        container.imageName = container.Image;
        container.containerState = container.State ?? container.Status;

        if (this.isNerdCtl) {
          container.started = container.containerState;
          if (container.Status.match(/exited/i)) {
            container.State = 'exited';
          } else {
            container.State = container.Status.toLowerCase();
          }
        }

        container.availableActions = [
          {
            label:      'Stop',
            action:     'stopContainer',
            enabled:    this.isRunning(container),
            bulkable:   true,
            bulkAction: 'stopContainer',
          },
          {
            label:      'Start',
            action:     'startContainer',
            enabled:    this.isStopped(container),
            bulkable:   true,
            bulkAction: 'startContainer',
          },
          {
            label:      this.t('images.manager.table.action.delete'),
            action:     'deleteContainer',
            enabled:    this.isStopped(container),
            bulkable:   true,
            bulkAction: 'deleteContainer',
          },
        ];

        if (!container.stopContainer) {
          container.stopContainer = (...args) => {
            this.stopContainer(...(args?.length > 0 ? args : [container]));
          };
        }

        if (!container.startContainer) {
          container.startContainer = (...args) => {
            this.startContainer(...(args?.length > 0 ? args : [container]));
          };
        }

        if (!container.deleteContainer) {
          container.deleteContainer = (...args) => {
            this.deleteContainer(...(args?.length > 0 ? args : [container]));
          };
        }

        return container;
      });
    },
    isNerdCtl() {
      return this.settings?.containerEngine?.name === ContainerEngine.CONTAINERD;
    },
    supportsNamespaces() {
      return this.settings?.containerEngine?.name === ContainerEngine.CONTAINERD;
    },
    selectedNamespace() {
      return this.supportsNamespaces ? this.settings?.containers.namespace : undefined;
    },
  },
  mounted() {
    this.$store.dispatch('page/setHeader', {
      title:       this.t('containers.title'),
      description: '',
    });

    ipcRenderer.on('settings-read', (event, settings) => {
      this.settings = settings;
      this.checkContainers().catch(console.error);
    });

    ipcRenderer.send('settings-read');

    ipcRenderer.on('settings-update', (_event, settings) => {
      this.settings = settings;
      this.containersList = [];
      this.checkSelectedNamespace();
    });

    this.checkContainers().catch(console.error);
    containerCheckInterval = setInterval(this.checkContainers.bind(this), 1_000);
  },
  beforeUnmount() {
    ipcRenderer.removeAllListeners('settings-update');
    ipcRenderer.removeAllListeners('containers-namespaces');
    ipcRenderer.removeAllListeners('containers-namespaces-containers');
    clearInterval(containerCheckInterval);
  },
  methods: {
    async checkContainers() {
      if (window.ddClient && this.isK8sReady && this.settings) {
        this.ddClient = window.ddClient;

        try {
          if (this.supportsNamespaces) {
            await this.getNamespaces();
          }
        } catch (error) {
          console.error('There was a problem fetching namespaces:', { error });
        }
        try {
          await this.getContainers();
          clearInterval(containerCheckInterval);
        } catch (error) {
          console.error('There was a problem fetching containers:', { error });
        }
      }
    },
    checkSelectedNamespace() {
      if (!this.supportsNamespaces || this.containersNamespaces.length === 0) {
        // Nothing to verify yet
        return;
      }
      if (!this.containersNamespaces.includes(this.selectedNamespace)) {
        const K8S_NAMESPACE = 'k8s.io';
        const defaultNamespace = this.containersNamespaces.includes(K8S_NAMESPACE) ? K8S_NAMESPACE : this.containersNamespaces[0];

        ipcRenderer.invoke('settings-write',
          { containers: { namespace: defaultNamespace } } );
      }
    },
    async onChangeNamespace(value) {
      if (value !== this.selectedNamespace) {
        await ipcRenderer.invoke('settings-write',
          { containers: { namespace: value.target.value } } );
        this.getContainers();
      }
    },
    clearDropDownPosition(e) {
      const target = e.target;

      const dropdownContent = target.querySelector('.dropdown-content');

      if (dropdownContent) {
        dropdownContent.style.top = '';
      }
    },
    addDropDownPosition(e) {
      const table = this.$refs.sortableTableRef.$el;
      const target = e.target;

      const dropdownContent = target.querySelector('.dropdown-content');

      if (dropdownContent) {
        const dropdownRect = target.getBoundingClientRect();
        const tableRect = table.getBoundingClientRect();
        const targetTopPos = dropdownRect.top - tableRect.top;
        const tableHeight = tableRect.height;

        if (targetTopPos < tableHeight / 2) {
          // Show dropdownContent below the target
          dropdownContent.style.top = `${ dropdownRect.bottom }px`;
        } else {
          // Show dropdownContent above the target
          dropdownContent.style.top = `${ dropdownRect.top - dropdownContent.getBoundingClientRect().height }px`;
        }
      }
    },
    async getNamespaces() {
      this.containersNamespaces = await this.ddClient?.docker.listNamespaces();
      this.checkSelectedNamespace();
    },
    async getContainers() {
      const containers = await this.ddClient?.docker.listContainers({ all: true, namespace: this.selectedNamespace });

      // Sorts by status, showing running first.
      this.containersList = containers.sort((a, b) => {
        if (a.State === 'running' && b.State !== 'running') {
          return -1;
        } else if (a.State !== 'running' && b.State === 'running') {
          return 1;
        } else {
          return a.State.localeCompare(b.State);
        }
      });

      // Filter out images from "kube-system" namespace
      this.containersList = this.containersList.filter((container) => {
        return container.Labels['io.kubernetes.pod.namespace'] !== 'kube-system';
      });
    },
    async stopContainer(container) {
      await this.execCommand('stop', container);
    },
    async startContainer(container) {
      await this.execCommand('start', container);
    },
    async deleteContainer(container) {
      await this.execCommand('rm', container);
    },
    isRunning(container) {
      return container.State === 'running' || container.Status === 'Up';
    },
    isStopped(container) {
      return container.State === 'created' || container.State === 'exited' || container.Status.includes('Exited');
    },
    /**
     * Execute a command against some containers
     * @param command {string} The command to run
     * @param _ids {Container | Container[]} The containers to affect
     */
    async execCommand(command, _ids) {
      try {
        const ids = Array.isArray(_ids) ? _ids.map(c => c.Id) : [_ids.Id];

        console.info(`Executing command ${ command } on container ${ ids }`);

        const { stderr, stdout } = await this.ddClient.docker.cli.exec(
          command,
          [...ids],
          { cwd: '/', namespace: this.selectedNamespace },
        );

        if (stderr) {
          throw new Error(stderr);
        }

        await this.getContainers();

        return stdout;
      } catch (error) {
        window.alert(error.message);
        console.error(`Error executing command ${ command }`, error.message);
      }
    },
    shortSha(sha) {
      const prefix = 'sha256:';

      if (sha.includes(prefix)) {
        const startIndex = sha.indexOf(prefix) + prefix.length;
        const actualSha = sha.slice(startIndex);

        return `${ sha.slice(0, startIndex) }${ actualSha.slice(0, 3) }..${ actualSha.slice(-3) }`;
      }

      return sha;
    },
    getTooltipConfig(sha) {
      if (!sha.includes('sha256:')) {
        return { content: undefined };
      }

      return { content: sha };
    },
    getUniquePorts(ports) {
      const keys = Object.keys(ports);

      if (!keys || Object.keys(keys).length === 0) {
        return [];
      }

      const uniquePortMap = keys.map((key) => {
        const values = ports[key];

        const hostPorts = values?.map(value => value.HostPort);
        const uniqueHostPorts = [...new Set(hostPorts)];

        return { [key]: uniqueHostPorts };
      });

      const displayMap = uniquePortMap.map((element) => {
        const key = Object.keys(element)[0];
        const values = element[key];
        const port = key.split('/')[0];

        return values.map(value => `${ value }:${ port }`);
      });

      return [].concat.apply([], displayMap);
    },
    shouldHaveDropdown(ports) {
      if (!ports) {
        return false;
      }

      return this.getUniquePorts(ports)?.length >= 3;
    },
    openUrl(port) {
      const hostPort = parseInt(port.split(':')[0]);

      if ([80, 443].includes(hostPort)) {
        hostPort === 80 ? shell.openExternal(`http://localhost`) : shell.openExternal(`https://localhost`);
      } else {
        return shell.openExternal(`http://localhost:${ hostPort }`);
      }
    },
  },
});
</script>

<style lang="scss" scoped>
.containers {
  &-status {
    padding: 8px 5px;
  }
}

.dropdown {
  position: relative;
  display: inline-block;

  span {
    cursor: pointer;
    padding: 5px;
  }

  &-content {
    display: none;
    position: fixed;
    z-index: 1;
    border-start-start-radius: var(--border-radius);
    background: var(--default);
    padding: 5px;
    transition: all 0.5s ease-in-out;

    a {
      display: block;
      padding: 5px 0;
    }
  }

  &:hover {
    & > .dropdown-content {
      display: block;
    }
  }
}

.link {
  cursor: pointer;
  text-decoration: none;
}

.state-container {
  padding: 8px 5px;
  margin-top: 5px;
}

.select-namespace {
  max-width: 24rem;
  min-width: 8rem;
}

.containersTable :deep(.search-box) {
  align-self: flex-end;
}
.containersTable :deep(.bulk) {
  align-self: flex-end;
}

.port-container {
  display: flex;
  gap: 5px;
}
</style>
