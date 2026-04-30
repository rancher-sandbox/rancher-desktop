<template>
  <div
    class="container-info-page"
    data-testid="container-info"
  >
    <rd-tabbed
      :key="containerId"
      :flat="true"
    >
      <!--
        Tab components are used only to register headers and emit @active events; their slots
        are intentionally empty. Content is rendered in .tab-content below so we can mix
        v-if (destroy/recreate on switch) with v-show (preserve the shell terminal's DOM and
        pty process across tab switches).
      -->
      <tab
        label="Logs"
        name="tab-logs"
        :weight="1"
        @active="activeTab = 'tab-logs'"
      />
      <tab
        label="Shell"
        name="tab-shell"
        :weight="0"
        :disabled="!isRunning"
        @active="activeTab = 'tab-shell'"
      />
      <template #tab-row-extras>
        <li
          v-if="activeTab === 'tab-logs'"
          class="search-widget"
          data-testid="search-widget"
        >
          <input
            ref="searchInput"
            v-model="searchTerm"
            aria-label="Search in logs"
            class="search-input"
            data-testid="search-input"
            placeholder="Search logs..."
            type="search"
            @input="onSearchInput"
            @keydown="handleSearchKeydown"
          >
          <button
            :disabled="!searchTerm"
            aria-label="Previous match"
            class="search-btn btn role-tertiary"
            data-testid="search-prev-btn"
            title="Previous match"
            @click="searchPrevious"
          >
            <i
              aria-hidden="true"
              class="icon icon-chevron-up"
            />
          </button>
          <button
            :disabled="!searchTerm"
            aria-label="Next match"
            class="search-btn btn role-tertiary"
            data-testid="search-next-btn"
            title="Next match"
            @click="searchNext"
          >
            <i
              aria-hidden="true"
              class="icon icon-chevron-down"
            />
          </button>
          <button
            :disabled="!searchTerm"
            aria-label="Clear search"
            class="search-btn btn role-tertiary"
            data-testid="search-clear-btn"
            title="Clear search"
            @click="clearSearch"
          >
            <i
              aria-hidden="true"
              class="icon icon-x"
            />
          </button>
        </li>
      </template>
      <div class="tab-content">
        <container-logs
          v-if="containerId && activeTab === 'tab-logs'"
          ref="containerLogs"
          :container-id="containerId"
          :is-container-running="isRunning"
          :namespace="namespace"
        />
        <container-shell
          v-if="shellEverActivated && containerId"
          v-show="activeTab === 'tab-shell'"
          ref="containerShell"
          :container-id="containerId"
          :is-container-running="isRunning"
          :namespace="namespace"
        />
      </div>
    </rd-tabbed>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted, onBeforeUnmount, nextTick } from 'vue';
import { useRoute } from 'vue-router';
import { useStore } from 'vuex';

import ContainerLogs from '@pkg/components/ContainerLogs.vue';
import ContainerShell from '@pkg/components/ContainerShell.vue';
import RdTabbed from '@pkg/components/Tabbed/RdTabbed.vue';
import Tab from '@pkg/components/Tabbed/Tab.vue';
import type { Settings } from '@pkg/config/settings';
import type { Container } from '@pkg/store/container-engine';
import { ipcRenderer } from '@pkg/utils/ipcRenderer';

// Router and Store
const route = useRoute();
const store = useStore();

// Template refs with proper typing
const containerLogs = ref<InstanceType<typeof ContainerLogs> | null>(null);
const containerShell = ref<InstanceType<typeof ContainerShell> | null>(null);
const searchInput = ref<HTMLInputElement | null>(null);

// Reactive data
const settings = ref<Settings>();
const subscribeTimer = ref<ReturnType<typeof setTimeout>>();
const searchTerm = ref('');
const activeTab = ref<'tab-logs' | 'tab-shell'>('tab-logs');
const shellEverActivated = ref(false);

// Vuex integration
const isK8sReady = computed(() => store.getters['k8sManager/isReady']);
const containers = computed(() => store.state['container-engine'].containers);
const supportsNamespaces = computed(() => store.getters['container-engine/supportsNamespaces']);
const namespace = computed(() => supportsNamespaces.value ? settings.value?.containers?.namespace : undefined);

// Computed properties
const containerId = computed(() => route.params.id as string || '');

const currentContainer = computed((): Container | null => {
  if (!containers.value || !containerId.value) {
    return null;
  }
  return containers.value[containerId.value] || null;
});

const containerName = computed(() => {
  if (!currentContainer.value) {
    return containerId.value.substring(0, 12);
  }
  const name = currentContainer.value.containerName;
  return name.replace(/^\//, '') || containerId.value.substring(0, 12);
});

const isRunning = computed(() => {
  if (!currentContainer.value) {
    return false;
  }
  return currentContainer.value.state === 'running';
});

// Watchers
watch(containerName, (name) => {
  store.dispatch('page/setHeader', {
    title:       name || 'Container Info',
    description: '',
    action:      'ContainerStatusBadge',
  });
}, { immediate: true });

watch(activeTab, (tab) => {
  if (tab === 'tab-shell') {
    shellEverActivated.value = true;
    nextTick(() => containerShell.value?.focus());
  }
});

// Methods as functions
const subscribe = async() => {
  if (subscribeTimer.value) {
    clearTimeout(subscribeTimer.value);
  }
  try {
    if (!window.ddClient || !isK8sReady.value || !settings.value) {
      subscribeTimer.value = setTimeout(subscribe, 1_000);
      return;
    }
    await store.dispatch('container-engine/subscribe', {
      type:   'containers',
      client: window.ddClient,
    });
  } catch (error) {
    console.error('There was a problem subscribing to container events:', { error });
  }
};

const onSearchInput = () => {
  containerLogs.value?.performSearch(searchTerm.value);
};

const searchNext = () => {
  containerLogs.value?.searchNext(searchTerm.value);
};

const searchPrevious = () => {
  containerLogs.value?.searchPrevious(searchTerm.value);
};

const clearSearch = () => {
  searchTerm.value = '';
  containerLogs.value?.clearSearch();
  nextTick(() => {
    searchInput.value?.focus();
  });
};

const handleSearchKeydown = (event: KeyboardEvent) => {
  if (event.key === 'Enter') {
    if (event.shiftKey) {
      searchPrevious();
    } else {
      searchNext();
    }
    event.preventDefault();
  } else if (event.key === 'Escape') {
    clearSearch();
    event.preventDefault();
  }
};

const handleGlobalKeydown = (event: KeyboardEvent) => {
  if (event.key === '/') {
    // Don't trigger if search input is already focused
    if (!searchInput.value?.contains(document.activeElement)) {
      event.preventDefault();
      searchInput.value?.focus();
      searchInput.value?.select();
    }
  }
};

// Event handlers
const handleSettingsUpdate = (_event: any, settingsData: any) => {
  settings.value = settingsData;
};

const handleSettingsRead = (_event: any, settingsData: any) => {
  settings.value = settingsData;
  subscribe().catch(console.error);
};

// Lifecycle hooks
onMounted(() => {
  ipcRenderer.send('settings-read');

  ipcRenderer.on('settings-update', handleSettingsUpdate);
  ipcRenderer.on('settings-read', handleSettingsRead);

  subscribe().catch(console.error);

  window.addEventListener('keydown', handleGlobalKeydown);
});

onBeforeUnmount(() => {
  store.dispatch('page/setHeader', { action: null });
  ipcRenderer.removeListener('settings-update', handleSettingsUpdate);
  ipcRenderer.removeListener('settings-read', handleSettingsRead);
  store.dispatch('container-engine/unsubscribe').catch(console.error);
  if (subscribeTimer.value) {
    clearTimeout(subscribeTimer.value);
  }
  window.removeEventListener('keydown', handleGlobalKeydown);
});
</script>

<style lang="scss" scoped>
.container-info-page {
  flex: 1;
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow: hidden;
  min-height: 0;
}

.search-widget {
  margin-left: auto;
  list-style: none;
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.25rem 0.5rem;
  flex-shrink: 0;
}

.search-input {
  border: 1px solid var(--border);
  border-radius: var(--border-radius);
  background: var(--input-bg);
  color: var(--body-text);
  font-size: 13px;
  padding: 0 0.75rem;
  min-width: 200px;
  height: 32px;
  transition: border-color 0.2s ease;

  &::placeholder {
    color: var(--muted);
  }

  &:focus {
    border-color: var(--primary);
    outline: none;
  }
}

.search-btn {
  background: transparent;
  border: 1px solid var(--border);
  border-radius: var(--border-radius);
  padding: 0;
  cursor: pointer;
  color: var(--body-text);
  transition: all 0.2s ease;
  display: flex;
  align-items: center;
  justify-content: center;
  min-width: 32px;
  min-height: 32px;

  &:hover:not(:disabled) {
    background: var(--primary);
    border-color: var(--primary);
    color: var(--primary-text);
  }

  &:disabled {
    opacity: 0.3;
    cursor: not-allowed;
  }

  &:focus-visible {
    outline: 2px solid var(--primary);
    outline-offset: -2px;
  }

  .icon {
    font-size: 12px;
  }
}

.tab-content {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-height: 0;
  overflow: hidden;
}

:deep(.container-logs-component),
:deep(.container-shell-component) {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-height: 0;
}
</style>
