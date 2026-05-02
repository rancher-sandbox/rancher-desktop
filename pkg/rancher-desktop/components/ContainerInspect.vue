<template>
  <div
    class="container-inspect"
    data-testid="container-inspect"
  >
    <div
      v-if="loading"
      class="loading-state"
      data-testid="info-loading"
    >
      <i class="icon icon-spinner icon-spin" />
      Loading container details…
    </div>

    <template v-else-if="data">
      <!-- Summary table -->
      <table
        class="summary-table"
        data-testid="info-summary-table"
      >
        <tbody>
          <tr data-testid="info-row-name">
            <th>Name</th>
            <td><code>{{ displayName }}</code></td>
          </tr>
          <tr data-testid="info-row-id">
            <th>ID</th>
            <td><code>{{ shortId }}</code></td>
          </tr>
          <tr data-testid="info-row-image">
            <th>Image</th>
            <td><code>{{ data.Config.Image }}</code></td>
          </tr>
          <tr data-testid="info-row-ip">
            <th>IP Address</th>
            <td><code>{{ ipAddress }}</code></td>
          </tr>
          <tr data-testid="info-row-created">
            <th>Created</th>
            <td>{{ formatDate(data.Created) }}</td>
          </tr>
          <tr
            v-if="data.State.Status === 'running'"
            data-testid="info-row-started"
          >
            <th>Started</th>
            <td>{{ formatDate(data.State.StartedAt) }}</td>
          </tr>
        </tbody>
      </table>

      <!-- Mounts -->
      <details
        class="inspect-section"
        data-testid="info-section-mounts"
      >
        <summary>
          Mounts <span class="count">({{ data.Mounts.length }})</span>
        </summary>
        <div
          v-if="data.Mounts.length"
          class="section-body"
        >
          <table class="detail-table">
            <thead>
              <tr>
                <th>Type</th>
                <th>Source</th>
                <th>Destination</th>
                <th>R/W</th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="(mount, i) in data.Mounts"
                :key="i"
              >
                <td>{{ mount.Type }}</td>
                <td><code>{{ mount.Source }}</code></td>
                <td><code>{{ mount.Destination }}</code></td>
                <td>{{ mount.RW ? 'RW' : 'RO' }}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <div
          v-else
          class="section-empty"
        >
          None
        </div>
      </details>

      <!-- Environment -->
      <details
        class="inspect-section"
        data-testid="info-section-env"
      >
        <summary>
          Environment <span class="count">({{ envVars.length }})</span>
        </summary>
        <div
          v-if="envVars.length"
          class="section-body"
        >
          <pre class="env-list">{{ envVars.join('\n') }}</pre>
        </div>
        <div
          v-else
          class="section-empty"
        >
          None
        </div>
      </details>

      <!-- Command & Args -->
      <details
        class="inspect-section"
        data-testid="info-section-command"
      >
        <summary>
          Command &amp; Args
        </summary>
        <div class="section-body">
          <table class="detail-table">
            <tbody>
              <tr v-if="entrypoint">
                <th>Entrypoint</th>
                <td><code>{{ entrypoint }}</code></td>
              </tr>
              <tr v-if="command">
                <th>Command</th>
                <td><code>{{ command }}</code></td>
              </tr>
              <tr v-if="data.Args.length">
                <th>Args</th>
                <td><code>{{ data.Args.join(' ') }}</code></td>
              </tr>
            </tbody>
          </table>
        </div>
      </details>

      <!-- Capabilities -->
      <details
        class="inspect-section"
        data-testid="info-section-capabilities"
      >
        <summary>
          Capabilities
        </summary>
        <div class="section-body">
          <table class="detail-table">
            <tbody>
              <tr>
                <th>Added</th>
                <td>{{ capAdd }}</td>
              </tr>
              <tr>
                <th>Dropped</th>
                <td>{{ capDrop }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </details>

      <!-- Ports -->
      <details
        class="inspect-section"
        data-testid="info-section-ports"
      >
        <summary>
          Ports <span class="count">({{ portEntries.length }})</span>
        </summary>
        <div
          v-if="portEntries.length"
          class="section-body"
        >
          <ul class="simple-list">
            <li
              v-for="(entry, i) in portEntries"
              :key="i"
            >
              <code>{{ entry }}</code>
            </li>
          </ul>
        </div>
        <div
          v-else
          class="section-empty"
        >
          None
        </div>
      </details>

      <!-- Labels -->
      <details
        class="inspect-section"
        data-testid="info-section-labels"
      >
        <summary>
          Labels <span class="count">({{ labelEntries.length }})</span>
        </summary>
        <div
          v-if="labelEntries.length"
          class="section-body"
        >
          <table class="detail-table">
            <tbody>
              <tr
                v-for="([key, value]) in labelEntries"
                :key="key"
              >
                <th>{{ key }}</th>
                <td>{{ value }}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <div
          v-else
          class="section-empty"
        >
          None
        </div>
      </details>
    </template>

    <div
      v-else
      class="error-state"
      data-testid="info-error"
    >
      <i class="icon icon-warning" />
      {{ error || 'An unknown error has occurred' }}
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue';
import { useStore } from 'vuex';

import type { ContainerInspectData } from '@pkg/store/container-engine';

const props = defineProps<{
  containerId: string;
  namespace:   string | undefined;
}>();

const store = useStore();
const data = computed<ContainerInspectData | undefined>(
  () => store.state['container-engine'].inspectData[props.containerId],
);
const loading = ref(true);
const error = ref<string | null>(null);

const fetchInspect = async() => {
  if (!props.containerId) {
    return;
  }
  loading.value = true;
  error.value = null;

  try {
    await store.dispatch('container-engine/fetchContainerInspect', {
      containerId: props.containerId,
      namespace:   props.namespace,
    });
  } catch (err: any) {
    error.value = err?.message ?? 'Failed to load container details.';
  } finally {
    loading.value = false;
  }
};

watch(() => props.containerId, fetchInspect, { immediate: true });

// Computed helpers
const displayName = computed(() => (data.value?.Name ?? '').replace(/^\//, ''));
const shortId = computed(() => (data.value?.Id ?? '').substring(0, 12));
const envVars = computed(() => data.value?.Config.Env ?? []);
const entrypoint = computed(() => (data.value?.Config.Entrypoint ?? []).join(' '));
const command = computed(() => (data.value?.Config.Cmd ?? []).join(' '));
const capAdd = computed(() => (data.value?.HostConfig.CapAdd ?? []).join(', ') || 'None');
const capDrop = computed(() => (data.value?.HostConfig.CapDrop ?? []).join(', ') || 'None');

const ipAddress = computed(() => {
  const primary = data.value?.NetworkSettings?.IPAddress;

  if (primary) {
    return primary;
  }
  // For containers on custom networks, the IP lives in Networks[name].IPAddress
  const ips = Object.values(data.value?.NetworkSettings?.Networks ?? {})
    .map((n) => n.IPAddress)
    .filter(Boolean);

  return ips.join(', ') || '—';
});

const labelEntries = computed(() => Object.entries(data.value?.Config.Labels ?? {}));

const portEntries = computed(() => {
  const ports = data.value?.NetworkSettings?.Ports ?? {};

  return Object.entries(ports).flatMap(([containerPort, bindings]) => {
    if (!bindings?.length) {
      return [containerPort];
    }

    return bindings.map(({ HostIp, HostPort }) => `${ HostIp }:${ HostPort } → ${ containerPort }`);
  });
});

const formatDate = (iso: string): string => {
  if (!iso || iso.startsWith('0001-')) {
    return '—';
  }
  return new Date(iso).toLocaleString();
};
</script>

<style lang="scss" scoped>
.container-inspect {
  padding: 1rem 1.5rem;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.loading-state,
.error-state {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 1rem;
  color: var(--body-text);
}

.error-state {
  color: var(--error);
}

// Summary table
.summary-table {
  border-collapse: collapse;
  width: 100%;
  max-width: 700px;

  th, td {
    padding: 0.4rem 0.75rem;
    text-align: left;
    border-bottom: 1px solid var(--border);
    vertical-align: top;
  }

  th {
    white-space: nowrap;
    width: 120px;
    color: var(--muted);
    font-weight: 500;
  }

  code {
    font-family: monospace;
    font-size: 0.875em;
  }
}

// Collapsible sections
.inspect-section {
  border: 1px solid var(--border);
  border-radius: var(--border-radius);
  overflow: hidden;

  &[open] > summary {
    border-bottom: 1px solid var(--border);

    &::before {
      transform: rotate(90deg);
    }
  }

  > summary {
    padding: 0.5rem 0.75rem;
    cursor: pointer;
    user-select: none;
    font-weight: 500;
    list-style: none;

    &::-webkit-details-marker {
      display: none;
    }

    &::before {
      content: '▶';
      display: inline-block;
      margin-right: 0.5rem;
      transition: transform 0.15s ease;
      font-size: 0.7em;
    }

    .count {
      color: var(--muted);
      font-weight: 400;
      font-size: 0.875em;
    }
  }
}

.section-body {
  padding: 0.75rem;
  overflow-x: auto;
}

.section-empty {
  padding: 0.5rem 0.75rem;
  color: var(--muted);
  font-style: italic;
}

// Detail tables (inside sections)
.detail-table {
  border-collapse: collapse;
  width: 100%;

  th, td {
    padding: 0.3rem 0.5rem;
    text-align: left;
    border-bottom: 1px solid var(--border);
    vertical-align: top;
  }

  th {
    white-space: nowrap;
    color: var(--muted);
    font-weight: 500;
    padding-right: 1rem;
  }

  code {
    font-family: monospace;
    font-size: 0.875em;
    word-break: break-all;
  }

  tr:last-child th,
  tr:last-child td {
    border-bottom: none;
  }
}

// Env list
.env-list {
  margin: 0;
  font-family: monospace;
  font-size: 0.875em;
  white-space: pre-wrap;
  word-break: break-all;
  color: var(--body-text);
}

// Ports list
.simple-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.25rem;

  code {
    font-family: monospace;
    font-size: 0.875em;
  }
}
</style>
