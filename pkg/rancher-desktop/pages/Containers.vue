<template>
  <div class="containers">
    <SortableTable
      ref="sortableTableRef"
      :headers="headers"
      key-field="Id"
      :rows="rows"
      no-rows-key="containers.sortableTables.noRows"
      :row-actions="true"
      :paging="true"
      :rows-per-page="10"
      :has-advanced-filtering="true"
      :loading="!containersList"
    >
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
import SortableTable from '@pkg/components/SortableTable';
import { BadgeState } from '@rancher/components';
import { shell } from 'electron';
import { mapGetters } from 'vuex';

let ddClientReady = false;
let containerCheckInterval = null;

export default {
  name:       'Containers',
  title:      'Containers',
  components: { SortableTable, BadgeState },
  data() {
    return {
      ddClient:       null,
      containersList: null,
      showRunning:    false,
      headers:        [
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

      const containers = structuredClone(this.containersList);

      return containers.map((container) => {
        container.state = container.State;
        container.containerName = container.Names[0].replace(
          /_[a-z0-9-]{36}_[0-9]+/,
          '',
        );
        container.started =
        container.State === 'running' ? container.Status : '';
        container.imageName = container.Image;

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

        container.containerState = container.State;

        return container;
      });
    },
  },

  mounted() {
    this.$store.dispatch('page/setHeader', {
      title:       this.t('containers.title'),
      description: '',
    });

    // INFO: We need to set ddClientReady outside of the component in the global scope so it won't re-render when we get the list.
    containerCheckInterval = setInterval(async() => {
      if (ddClientReady || this.containersList) {
        return;
      }

      console.debug('Checking for containers...');

      if (window.ddClient && this.isK8sReady) {
        this.ddClient = window.ddClient;

        try {
          await this.getContainers();
        } catch (error) {
          console.error('There was a problem fetching containers:', { error });
        }
      }
    }, 1000);
  },
  beforeDestroy() {
    ddClientReady = false;
    clearInterval(containerCheckInterval);
  },
  methods: {
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
    async getContainers() {
      const containers = await this.ddClient?.docker.listContainers({ all: true });

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
        return !container.Labels['io.kubernetes.pod.namespace'] || container.Labels['io.kubernetes.pod.namespace'] !== 'kube-system';
      });

      ddClientReady = true;
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
      return container.State === 'running';
    },
    isStopped(container) {
      return container.State === 'created' || container.State === 'exited';
    },
    async execCommand(command, _ids) {
      try {
        const ids = _ids?.length ? _ids.map(e => e.Id) : [_ids.Id];

        console.info(`Executing command ${ command } on container ${ ids }`);

        const { stderr, stdout } = await this.ddClient.docker.cli.exec(
          command,
          [...ids],
          { cwd: '/' },
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
      const displayMap = [];

      for (const [key, values] of Object.entries(ports)) {
        try {
          const hostPorts = (values || []).map(value => value.HostPort);
          const port = key.split('/')[0];

          for (const hostPort of new Set(hostPorts)) {
            displayMap.push(`${ hostPort }:${ port }`);
          }
        } catch (ex) {
          console.log(`Error trying to get the port map for key ${ key }, targets: ${ values }: ${ ex }`);
        }
      }

      return displayMap;
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
};
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

.port-container {
  display: flex;
  gap: 5px;
}
</style>
