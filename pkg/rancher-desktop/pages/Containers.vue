<template>
  <div class="containers">
    <SortableTable
      :headers="headers"
      key-field="Id"
      :rows="rows"
      no-rows-key="containers.sortableTables.noRows"
      :row-actions="true"
      :paging="true"
      :rows-per-page="10"
      :loading="!containersList"
      @selection="handleSelection"
    >
      <template #col:ports="{ row }">
        <td class="port-container">
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
          >
            <span>
              {{ t('containers.manage.table.showMore') }}
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
        </td>
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
    </SortableTable>
  </div>
</template>

<script>
import SortableTable from '@pkg/components/SortableTable';
import { BadgeState } from '@rancher/components';
import { shell } from 'electron';

let ddClientReady = false;

export default {
  name:       'Containers',
  title:      'Containers',
  components: { SortableTable, BadgeState },
  data() {
    return {
      ddClient:       null,
      containersList: null,
      selected:       [],
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
            icon:       'icon icon-pause',
            bulkable:   true,
            bulkAction: 'stopContainers',
          },
          {
            label:      'Start',
            action:     'startContainer',
            enabled:    this.isStopped(container),
            icon:       'icon icon-start',
            bulkable:   true,
            bulkAction: 'startContainer',
          },
          {
            label:      this.t('images.manager.table.action.delete'),
            action:     'deleteContainer',
            enabled:    true,
            icon:       'icon icon-delete',
            bulkable:   true,
            bulkAction: 'deleteContainers',
          },
        ];

        if (!container.stopContainer) {
          container.stopContainer = () => {
            this.stopContainer(container);
          };
        }

        if (!container.startContainer) {
          container.startContainer = () => {
            this.startContainer(container);
          };
        }

        if (!container.deleteContainer) {
          container.deleteContainer = () => {
            this.deleteContainer(container);
          };
        }

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
    setInterval(async() => {
      if (ddClientReady || this.containersList) {
        return;
      }

      console.debug('Checking for containers...');

      if (window.ddClient) {
        this.ddClient = window.ddClient;

        await this.getContainers();
      }
    }, 1000);
  },
  beforeDestroy() {
    ddClientReady = false;
  },
  methods: {
    handleSelection(item) {
      this.selected = [...item];
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
    async execCommand(command, container) {
      try {
        const ids =
          this.selected.length > 1 ? [...this.selected.map(container => container.Id)] : [container.Id];

        console.info(`Executing command ${ command } on container(s) ${ ids }`);

        const { stderr, stdout } = await this.ddClient.docker.cli.exec(
          command,
          [...ids],
        );

        if (stderr) {
          throw new Error(stderr);
        }

        await this.getContainers();

        return stdout;
      } catch (error) {
        // TODO: Remove ?
        window.alert(error.message);
        console.error(`Error executing command ${ command }`, error.message);
      }
    },
    shortSha(sha) {
      if (!sha.startsWith('sha256:')) {
        return sha;
      }

      return `${ sha.slice(0, 10) }..${ sha.slice(-5) }`;
    },
    getTooltipConfig(sha) {
      if (!sha.startsWith('sha256:')) {
        return { content: undefined };
      }

      return { content: sha };
    },
    getUniquePorts(obj) {
      const uniquePorts = {};

      Object.keys(obj).forEach((key) => {
        const ports = obj[key];

        if (!ports) {
          return;
        }

        const firstPort = ports[0].HostPort;
        const secondPort = ports[1].HostPort;

        uniquePorts[`${ firstPort }:${ secondPort }`] = true;
      });

      return Object.keys(uniquePorts);
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

  &-content {
    display: none;
    position: absolute;
    z-index: 1;
    padding-top: 5px;
    border-start-start-radius: var(--border-radius);
    background: var(--default);
    padding: 5px;

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
  flex-direction: column;
  margin: 5px 0;
}
</style>
