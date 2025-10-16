<template>
  <div class="containers">
    <banner
      v-if="errorMessage"
      color="error"
      @close="clearError"
    >
      {{ errorMessage }}
    </banner>
    <SortableTable
      ref="sortableTableRef"
      class="containersTable"
      :headers="headers"
      key-field="id"
      :rows="rows"
      no-rows-key="containers.sortableTables.noRows"
      :row-actions="true"
      :paging="true"
      :rows-per-page="10"
      :has-advanced-filtering="false"
      :loading="containers === null"
      group-by="projectGroup"
      :group-sort="['projectGroup']"
    >
      <template #header-middle>
        <div class="header-middle">
          <div v-if="supportsNamespaces">
            <label>Namespace</label>
            <select
              class="select-namespace"
              :value="namespace"
              @change="onChangeNamespace($event)"
            >
              <option
                v-for="item in namespaces"
                :key="item"
                :value="item"
                :selected="item === namespace"
              >
                {{ item }}
              </option>
            </select>
          </div>
        </div>
      </template>
      <template #col:containerState="{ row }">
        <td>
          <badge-state
            :color="isRunning(row) ? 'bg-success' : 'bg-darker'"
            :label="row.state"
          />
        </td>
      </template>
      <template #col:imageName="{ row }">
        <td>
          <span v-tooltip="getTooltipConfig(row.imageName)">
            {{ shortSha(row.imageName) }}
          </span>
        </td>
      </template>
      <template #col:containerName="{ row }">
        <td>
          <a
            v-tooltip="getTooltipConfig(row.containerName)"
            class="container-name-link"
            @click.stop.prevent="navigateToInfo(row)"
          >
            {{ shortSha(row.containerName) }}
          </a>
        </td>
      </template>
      <template #col:ports="{ row }">
        <td>
          <div class="port-container">
            <a
              v-for="[hostPort, containerPort] in row.portList.slice(0, 2)"
              :key="hostPort"
              target="_blank"
              class="link"
              @click="openUrl(hostPort)"
            >
              {{ hostPort }}:{{ containerPort }}
            </a>

            <div
              v-if="shouldHaveDropdown(row.portList)"
              class="dropdown"
              @mouseenter="addDropDownPosition"
              @mouseleave="clearDropDownPosition"
            >
              <span>
                ...
              </span>
              <div class="dropdown-content">
                <a
                  v-for="[hostPort, containerPort] in row.portList.slice(2)"
                  :key="hostPort"
                  target="_blank"
                  class="link"
                  @click="openUrl(hostPort)"
                >
                  {{ hostPort }}:{{ containerPort }}
                </a>
              </div>
            </div>
          </div>
        </td>
      </template>
      <template #group-row="{ group }">
        <tr
          class="group-row"
          :aria-expanded="!collapsed[group.ref]"
        >
          <td :colspan="headers.length + 1">
            <div class="group-tab">
              <i
                data-title="Toggle Expand"
                :class="{
                  icon: true,
                  'icon-chevron-right': !!collapsed[group.ref],
                  'icon-chevron-down': !collapsed[group.ref],
                }"
                @click.stop="toggleExpand(group.ref)"
              />
              {{ group.ref }}
              <span v-if="!!collapsed[group.ref]"> ({{ group.rows.length }})</span>
            </div>
          </td>
        </tr>
      </template>
    </SortableTable>
  </div>
</template>

<script>
import { BadgeState, Banner } from '@rancher/components';
import { shell } from 'electron';
import merge from 'lodash/merge';
import { defineComponent } from 'vue';
import { mapGetters } from 'vuex';

import SortableTable from '@pkg/components/SortableTable';
import { mapTypedGetters, mapTypedState } from '@pkg/entry/store';
import { ipcRenderer } from '@pkg/utils/ipcRenderer';

/**
 * @import { Container } from '@pk/store/containers'
 */

/**
 * @typedef { Object } Action
 * @property { string } label
 * @property { string } action
 * @property { boolean } enabled
 * @property { boolean } bulkable
 * @property { boolean } [bulkAction]
 */

/**
 * @typedef { Container } RowItem An item in the table row
 * @property { Action[] } [availableActions]
 * @property { (this: Container, containers?: Container[]) => void } [stopContainer]
 * @property { (this: Container, containers?: Container[]) => void } [startContainer]
 * @property { (this: Container, containers?: Container[]) => void } [deleteContainer]
 * @property { (this: Container) => void } [viewInfo]
 * @property { (readonly [number, number])[] } portList
 */

export default defineComponent({
  name:       'Containers',
  title:      'Containers',
  components: { SortableTable, BadgeState, Banner },
  data() {
    return {
      /** @type import('@pkg/config/settings').Settings | undefined */
      settings:                   undefined,
      /** @type string | null */
      execError:                  null,
      /** @type Record<string, boolean> */
      collapsed:                   {},
      /**
       * This timer is used to retry subscribing to events until the backend is
       * ready enough to update the vuex store.
       * @type ReturnType<typeof setTimeout> | undefined
       */
      subscribeTimer:       undefined,
      headers:              [
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
    ...mapTypedState('container-engine', ['containers', 'namespaces']),
    ...mapTypedGetters('container-engine', ['namespace', 'supportsNamespaces', 'error']),
    /** @returns {RowItem[]} */
    rows() {
      if (!this.containers) {
        return [];
      }
      return Object.values(this.containers)
        .filter(container => {
          // Filter out containers from the 'kube-system' namespace
          return this.supportsNamespaces || container.labels['io.kubernetes.pod.namespace'] !== 'kube-system';
        })
        .sort((a, b) => {
          // Sort by status, showing running first.
          if ((a.state === 'running' || b.state === 'running') && a.state !== b.state) {
            // One of the two is running; put that first.
            return a.state === 'running' ? -1 : 1;
          }
          // Both or running, or neither.
          return a.state.localeCompare(b.state) || a.id.localeCompare(b.id);
        })
        .map(container => merge({}, container, {
          availableActions: [
            {
              label:      'Info',
              action:     'viewInfo',
              enabled:    true,
              bulkable:   false,
            },
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
          ],
          stopContainer:   (args) => {
            this.execCommand('stop', args?.length ? args : container);
          },
          startContainer:   (args) => {
            this.execCommand('start', args?.length ? args : container);
          },
          deleteContainer:   (args) => {
            this.execCommand('rm', args?.length ? args : container);
          },
          viewInfo: () => {
            this.viewInfo(container);
          },
          portList: this.getPortList(container),
        }));
    },
    errorMessage() {
      if (this.errorMessage) {
        return this.errorMessage;
      }
      switch (this.error?.source) {
      case 'containers': case 'namespaces':
        return `${ this.error.error }`;
      }
      return null;
    },
  },
  mounted() {
    this.$store.dispatch('page/setHeader', {
      title:       this.t('containers.title'),
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
    ipcRenderer.removeAllListeners('settings-update');
    this.$store.dispatch('container-engine/unsubscribe').catch(console.error);
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
          type:      'containers',
          client:    window.ddClient,
        });
      } catch (error) {
        console.error('There was a problem subscribing to container events:', { error });
      }
    },

    checkSelectedNamespace() {
      if (!this.supportsNamespaces || !this.namespaces?.length) {
        // Nothing to verify yet
        return;
      }
      if (!this.namespaces.includes(this.namespace)) {
        const K8S_NAMESPACE = 'k8s.io';
        const defaultNamespace = this.namespaces.includes(K8S_NAMESPACE) ? K8S_NAMESPACE : this.namespaces[0];

        ipcRenderer.invoke('settings-write',
          { containers: { namespace: defaultNamespace } } );
      }
    },
    async onChangeNamespace(event) {
      const { value } = event.target;
      if (value !== this.namespace) {
        await ipcRenderer.invoke('settings-write',
          { containers: { namespace: value } } );
        this.$store.dispatch('container-engine/subscribe', {
          type:      'containers',
          client:    window.ddClient,
          namespace: value,
        });
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
    viewInfo(container) {
      this.$router.push(`/containers/info/${ container.id }`);
    },
    navigateToInfo(container) {
      this.$router.push(`/containers/info/${ container.id }`);
    },
    /** @param container {RowItem} */
    isRunning(container) {
      return container.state === 'running' || container.status === 'Up';
    },
    /** @param container {RowItem} */
    isStopped(container) {
      return container.state === 'created' || container.state === 'exited';
    },
    /**
     * Execute a command against some containers
     * @param command {string} The command to run
     * @param _ids {Container | Container[]} The containers to affect
     */
    async execCommand(command, _ids) {
      try {
        const ids = Array.isArray(_ids) ? _ids.map(c => c.id) : [_ids.id];
        const options = { cwd: '/' };

        console.info(`Executing command ${ command } on container ${ ids }`);
        if (this.supportsNamespaces) {
          options.namespace = this.namespace;
        }

        const { stderr, stdout } = await window.ddClient.docker.cli.exec(command, [...ids], options);

        if (stderr) {
          throw new Error(stderr);
        }

        return stdout;
      } catch (error) {
        const extractErrorMessage = (err) => {
          const rawMessage = err?.message || err?.stderr || err || '';

          if (typeof rawMessage === 'string') {
            // Extract message from fatal/error format: time="..." level=fatal msg="actual message"
            const msgMatch = rawMessage.match(/msg="((?:[^"\\]|\\.)*)"/);
            if (msgMatch) {
              return msgMatch[1];
            }

            // Fallback: remove timestamp and level prefixes
            const cleanedMessage = rawMessage
              .replace(/time="[^"]*"\s*/g, '')
              .replace(/level=(fatal|error|info)\s*/g, '')
              .replace(/msg="/g, '')
              .replace(/"\s*Error: exit status \d+/g, '')
              .trim();

            if (cleanedMessage) {
              return cleanedMessage;
            }
          }

          return `Failed to execute command: ${ command }`;
        };

        this.execError = extractErrorMessage(error);
        console.error(`Error executing command ${ command }`, error);
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
    /**
     * @param container {Container}
     * @returns {[number, number][]} (host port, container port) tuples, sorted by host port.
     */
    getPortList(container) {
      /** @type [string, { HostIp: string, HostPort: string}][] */
      const rawPorts = Object.entries(container.ports).filter(([, host]) => !!host);
      // Convert to a map to make sure it's unique by host port
      /** @type Record<string, string> */
      const mapping = Object.fromEntries(rawPorts.flatMap(([portDef, entries]) => {
        return entries.map(({ HostPort }) => [HostPort, portDef.split('/')[0]]);
      }));
      return Object.entries(mapping).map(([h, c]) => [parseInt(h, 10), parseInt(c, 10)]);
    },
    /** @param ports {(readonly [number, number])[]} */
    shouldHaveDropdown(ports) {
      if (!ports) {
        return false;
      }

      return ports.length >= 3;
    },
    openUrl(hostPort) {
      if ([80, 443].includes(hostPort)) {
        hostPort === 80 ? shell.openExternal(`http://localhost`) : shell.openExternal(`https://localhost`);
      } else {
        return shell.openExternal(`http://localhost:${ hostPort }`);
      }
    },

    toggleExpand(group) {
      this.collapsed[group] = !this.collapsed[group];
    },

    clearError() {
      this.execError = null;
      switch (this.error?.source) {
      case 'namespaces': case 'containers':
        this.$store.commit('container-engine/SET_ERROR', null);
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

  .group-row {
    .group-tab {
      font-weight: bold;
      .icon {
        cursor: pointer;
      }
    }
    &[aria-expanded="false"] {
      :deep(~ .main-row) {
        visibility: collapse;
        .checkbox-container {
          /* When using visibility:collapse, the row selection checkbox produces
           * some artifacts; force it to display:none to avoid flickering. */
          display: none;
        }
      }
    }
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

.container-name-link {
  color: var(--link);
  cursor: pointer;
  text-decoration: none;

  &:hover {
    text-decoration: underline;
    color: var(--link-hover);
  }
}

.port-container {
  display: flex;
  gap: 5px;
}
</style>
