<!--
  - This is the PortForwarding table in the K8s page.
  -->
<template>
  <div>
    <SortableTable
      :headers="headers"
      :rows="rows"
      key-field="key"
      default-sort-by="namespace"
      :table-actions="false"
      :paging="true"
      :row-actions-width="parseInt(157, 10)"
    >
      <template #header-middle>
        <Checkbox
          :label="'Include Kubernetes services'"
          :value="includeKubernetesServices"
          :disabled="!isRunning || kubernetesIsDisabled"
          @input="handleCheckbox"
        />
      </template>
      <template #row-actions="{row}">
        <div v-if="row.row.listenPort === undefined && !serviceBeingEditedIs(row.row)" class="action-div">
          <button
            class="btn btn-sm role-tertiary"
            @click="editPortForward(row.row)"
          >
            Forward
          </button>
        </div>
        <div v-else-if="serviceBeingEditedIs(row.row)" class="action-div">
          <button
            class="btn btn-sm role-tertiary"
            @click="updatePortForward()"
          >
            Apply
          </button>
          <input
            type="number"
            :value="serviceBeingEdited.listenPort"
            @input="updateServiceBeingEdited"
            class="action-input"
          >
        </div>
        <div v-else class="action-div">
          <button
            class="btn btn-sm role-tertiary"
            @click="cancelPortForward(row.row)"
          >
            Cancel
          </button>
        </div>
      </template>
    </SortableTable>
  </div>
</template>

<script lang="ts">
import { ipcRenderer } from 'electron';
import SortableTable from '@/components/SortableTable/index.vue';
import Checkbox from '@/components/form/Checkbox.vue';
import * as K8s from '@/k8s-engine/k8s';
import Vue, { PropType }from 'vue';

type ServiceEntryWithKey = K8s.ServiceEntry & { key: string }

export default Vue.extend({
  components: { SortableTable, Checkbox },
  props:      {
    services: {
      type:     Array as PropType<K8s.ServiceEntry[]>,
      required: true,
    },
    includeKubernetesServices: {
      type:    Boolean,
      default: false,
    },
    k8sState: {
      type:    Number,
      default: K8s.State.STOPPED,
    },
    kubernetesIsDisabled: {
      type:    Boolean,
      default: false,
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
      serviceBeingEdited: null as K8s.ServiceEntry | null,
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

      return services.map(service => {
        const port = typeof service.port === 'number' ? service.port.toString() : service.port;
        return {
          namespace:  service.namespace,
          name:       service.name,
          portName:   service.portName ?? port,
          port:       service.port,
          listenPort: service.listenPort,
          key:        `${ service.namespace }/${ service.name }:${ service.portName }`,
        }
      });
    },
  },
  methods: {
    editPortForward(service: K8s.ServiceEntry): void {
      this.serviceBeingEdited = Object.assign({}, service);
      ipcRenderer.invoke('service-forward', service, true);
    },
    serviceBeingEditedIs(service: K8s.ServiceEntry): boolean {
      if (this.serviceBeingEdited === null) {
        return false;
      }

      // compare the two services, minus listenPort property, since this may differ
      return this.serviceBeingEdited.name === service.name &&
        this.serviceBeingEdited.namespace === service.namespace &&
        this.serviceBeingEdited.port === service.port;
    },
    updateServiceBeingEdited(event: any): void {
      if (this.serviceBeingEdited) {
        this.serviceBeingEdited.listenPort = parseInt(event.target.value, 10);
      }
    },
    updatePortForward(): void {
      ipcRenderer.invoke('service-forward', this.serviceBeingEdited, true);
      this.serviceBeingEdited = null;
    },
    cancelPortForward(service: K8s.ServiceEntry): void {
      ipcRenderer.invoke('service-forward', service, false);
    },
    handleCheckbox(value: boolean): void {
      this.$emit('toggledServiceFilter', value);
    }
  },
  watch: {
    services(newServices: K8s.ServiceEntry[]): void {
      const service = newServices.find(service => this.serviceBeingEditedIs(service));
      if (service && this.serviceBeingEdited) {
        this.serviceBeingEdited.listenPort = service.listenPort;
      } else {
        this.serviceBeingEdited = null;
      }
    }
  },
});
</script>

<style>
.action-div {
  display: flex;
  flex-direction: row-reverse;
  gap: 0.5rem;
  padding: 0rem;
}
.action-input {
  max-height: 30px; /* to match min-height on btn-sm class */
}
</style>
