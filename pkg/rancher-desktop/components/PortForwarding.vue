<!--
  - This is the PortForwarding table in the K8s page.
  -->
<template>
  <div>
    <Banner
      v-if="errorMessage"
      color="error"
      :closable="true"
      class="banner"
      @close="emitCloseError"
    >
      {{ errorMessage }}
    </Banner>
    <SortableTable
      :headers="headers"
      :rows="rows"
      no-rows-key="portForwarding.sortableTables.noRows"
      key-field="key"
      default-sort-by="namespace"
      :table-actions="false"
      :paging="true"
      :row-actions-width="parseInt(95, 10)"
    >
      <template #header-middle>
        <div class="header-middle">
          <Checkbox
            class="kubernetes-services"
            :label="'Include Kubernetes services'"
            :value="includeKubernetesServices"
            :disabled="!isRunning || kubernetesIsDisabled"
            @input="handleCheckbox"
          />
        </div>
      </template>
      <template #col:listenPort="{row}">
        <div
          v-if="serviceBeingEditedIs(row)"
          class="listen-port-div"
        >
          <input
            v-focus
            type="number"
            :value="serviceBeingEdited.listenPort"
            class="listen-port-input"
            @input="emitUpdatePort"
            @keyup.enter="emitUpdatePortForward"
          >
        </div>
        <div v-else>
          <p class="listen-port-p">
            {{ row.listenPort }}
          </p>
        </div>
      </template>
      <template #row-actions="{row}">
        <div
          v-if="row.row.listenPort === undefined && !serviceBeingEditedIs(row.row)"
          class="action-div"
        >
          <button
            class="btn btn-sm role-tertiary"
            @click="emitEditPortForward(row.row)"
          >
            Forward
          </button>
        </div>
        <div
          v-else-if="serviceBeingEditedIs(row.row)"
          class="action-div"
        >
          <button
            class="btn btn-sm role-tertiary btn-icon"
            @click="emitCancelEditPortForward(row.row)"
          >
            <span class="icon icon-x icon-lg" />
          </button>
          <button
            class="btn btn-sm role-tertiary btn-icon"
            @click="emitUpdatePortForward()"
          >
            <span class="icon icon-checkmark icon-lg" />
          </button>
        </div>
        <div
          v-else
          class="action-div"
        >
          <button
            class="btn btn-sm role-tertiary"
            @click="emitCancelPortForward(row.row)"
          >
            Cancel
          </button>
        </div>
      </template>
    </SortableTable>
  </div>
</template>

<script lang="ts">
import { Banner, Checkbox } from '@rancher/components';
import { defineComponent } from 'vue';

import * as K8s from '@pkg/backend/k8s';
import SortableTable from '@pkg/components/SortableTable/index.vue';

import type { PropType } from 'vue';

type ServiceEntryWithKey = K8s.ServiceEntry & { key: string };

export default defineComponent({
  name:       'port-forwarding',
  components: {
    SortableTable, Checkbox, Banner,
  },
  directives: {
    focus: {
      inserted(element) {
        element.focus();
      },
    },
  },
  props: {
    services: {
      type:     Array as PropType<K8s.ServiceEntry[]>,
      required: true,
    },
    includeKubernetesServices: {
      type:    Boolean,
      default: false,
    },
    k8sState: {
      type:    String as PropType<K8s.State>,
      default: K8s.State.STOPPED,
    },
    kubernetesIsDisabled: {
      type:    Boolean,
      default: false,
    },
    // Used to determine which row to allow editing of listenPort on.
    serviceBeingEdited: {
      type:    Object as PropType<K8s.ServiceEntry>,
      default: null,
    },
    errorMessage: {
      type:    String,
      default: null,
    },
  },

  data() {
    return {
      headers: [
        {
          name:  'namespace',
          label: 'Namespace',
          sort:  ['namespace', 'name'],
        },
        {
          name:  'name',
          label: 'Name',
          sort:  ['name', 'namespace'],
        },
        {
          name:  'portName',
          label: 'Port',
          sort:  ['portName', 'namespace', 'name'],
        },
        {
          name:  'listenPort',
          label: 'Local Port',
          sort:  ['listenPort', 'namespace', 'name'],
        },
      ],
    };
  },
  computed: {
    isRunning(): boolean {
      return this.k8sState === K8s.State.STARTED;
    },
    rows(): ServiceEntryWithKey[] {
      let services = this.services;

      if (!this.includeKubernetesServices) {
        services = services
          .filter(service => service.namespace !== 'kube-system')
          .filter(service => !(service.namespace === 'default' && service.name === 'kubernetes'));
      }

      return services.map((service) => {
        const port = typeof service.port === 'number' ? service.port.toString() : service.port;

        return {
          namespace:  service.namespace,
          name:       service.name,
          portName:   service.portName ?? port,
          port:       service.port,
          listenPort: service.listenPort,
          key:        `${ service.namespace }/${ service.name }:${ service.portName }`,
        };
      });
    },
  },
  methods: {
    serviceBeingEditedIs(service: K8s.ServiceEntry): boolean {
      if (this.serviceBeingEdited === null) {
        return false;
      }

      // compare the two services, minus listenPort property, since this may differ
      return this.serviceBeingEdited.name === service.name &&
        this.serviceBeingEdited.namespace === service.namespace &&
        this.serviceBeingEdited.port === service.port;
    },
    emitUpdatePort(event: any): void {
      const portBeingEdited = parseInt(event.target.value, 10);

      this.$emit('updatePort', portBeingEdited);
    },
    handleCheckbox(value: boolean): void {
      this.$emit('toggledServiceFilter', value);
    },
    emitEditPortForward(service: K8s.ServiceEntry): void {
      this.$emit('editPortForward', service);
    },
    emitCancelPortForward(service: K8s.ServiceEntry): void {
      this.$emit('cancelPortForward', service);
    },
    emitCancelEditPortForward(service: K8s.ServiceEntry): void {
      this.$emit('cancelEditPortForward', service);
    },
    emitUpdatePortForward(): void {
      this.$emit('updatePortForward');
    },
    emitCloseError(): void {
      this.$emit('closeError');
    },
  },
});
</script>

<style>
  .btn-icon {
    display: flex;
    flex-direction: row;
    justify-content: center;
    align-items: center;
  }

  .action-div {
    display: flex;
    flex-direction: row-reverse;
    gap: 0.5rem;
  }

  .listen-port-div {
    height: 100%;
    width: 6rem;
  }

  .listen-port-input {
    max-height: 30px;
    margin: 8px 0;
  }

  .listen-port-p {
    margin: 15px 11px;
  }

  .header-middle {
    display: flex;
    align-items: flex-end;
    gap: 1rem;
    height: 100%;
  }

  .kubernetes-services {
    margin-bottom: 12px;
  }

</style>
