<router lang="yaml">
  name: Kubernetes Settings
</router>
<template>
  <notifications
    class="k8s-wrapper"
    :notifications="notificationsList"
  >
    <div class="kubernetes-settings">
      <labeled-input label="Kubernetes version">
        <template #field>
          <select class="select-k8s-version" :value="settings.kubernetes.version" @change="onChange($event)">
            <!--
              - On macOS Chrome / Electron can't style the <option> elements.
              - We do the best we can by instead using <optgroup> for a recommended section.
              -->
            <optgroup v-if="recommendedVersions.length > 0" label="Recommended Versions">
              <option
                v-for="item in recommendedVersions"
                :key="item.version.version"
                :value="item.version.version"
                :selected="item.version.version === savedVersion"
              >
                {{ versionName(item) }}
              </option>
            </optgroup>
            <optgroup v-if="nonRecommendedVersions.length > 0" label="Other Versions">
              <option
                v-for="item in nonRecommendedVersions"
                :key="item.version.version"
                :value="item.version.version"
                :selected="item.version.version === savedVersion"
              >
                v{{ item.version.version }}
              </option>
            </optgroup>
          </select>
        </template>
      </labeled-input>
      <labeled-input
        :value="settings.kubernetes.port"
        label="Port"
        type="number"
        data-test="portConfig"
        @input="handleUpdatePort"
      />
      <checkbox
        :value="settings.kubernetes.options.traefik"
        class="feature"
        label="Enable Traefik"
        @input="handleUpdateFeatures('traefik', $event)"
      />
    </div>
    <engine-selector
      :container-engine="settings.kubernetes.containerEngine"
      :row="true"
      @change="onChangeEngine"
    >
      <template #label>
        <h4>
          {{ t('containerRuntime.label') }}
        </h4>
      </template>
    </engine-selector>
    <system-preferences
      v-if="hasSystemPreferences"
      :memory-in-g-b="settings.kubernetes.memoryInGB"
      :number-c-p-us="settings.kubernetes.numberCPUs"
      :avail-memory-in-g-b="availMemoryInGB"
      :avail-num-c-p-us="availNumCPUs"
      :reserved-memory-in-g-b="6"
      :reserved-num-c-p-us="1"
      @update:memory="handleUpdateMemory"
      @update:cpu="handleUpdateCPU"
      @warning="handleWarning"
      @error="handleError"
    />

    <div class="reset-kubernetes">
      <split-button
        class="role-secondary btn-reset"
        data-test="k8sResetBtn"
        label="Reset Kubernetes"
        value="auto"
        :disabled="hasError || cannotReset"
        :options="[{id: 'wipe', label: 'Reset Kubernetes and Container Images'}]"
        @input="reset"
      />
      <label>
        Resetting Kubernetes to default will delete all workloads and configuration
      </label>
    </div>
  </notifications>
</template>

<script>
import os from 'os';

import { ipcRenderer } from 'electron';
import semver from 'semver';

import Checkbox from '@/components/form/Checkbox.vue';
import SplitButton from '@/components/form/SplitButton.vue';
import LabeledInput from '@/components/form/LabeledInput.vue';
import EngineSelector from '@/components/EngineSelector.vue';
import Notifications from '@/components/Notifications.vue';
import SystemPreferences from '@/components/SystemPreferences.vue';
import { ContainerEngine, ContainerEngineNames, defaultSettings } from '@/config/settings';
import * as K8s from '@/k8s-engine/k8s';

/** @typedef { import("../config/settings").Settings } Settings */

const NotificationLevels = ['error', 'warning', 'info', 'success'];

export default {
  name:       'K8s',
  title:      'Kubernetes Settings',
  components: {
    Checkbox,
    EngineSelector,
    SplitButton,
    LabeledInput,
    Notifications,
    SystemPreferences,
  },
  data() {
    return {
      /** @type {{ key: string, message: string, level: string }} */
      notifications:        { },
      state:                ipcRenderer.sendSync('k8s-state'),
      currentPort:          0,
      currentEngine:        ContainerEngine.NONE,
      containerEngineNames: ContainerEngineNames,
      /** @type Settings */
      settings:             defaultSettings,
      /** @type {import('@/k8s-engine/k8s').VersionEntry[] */
      versions:             [],
      progress:             {
        current: 0,
        max:     0,
      },
      containerEngineChangePending: false,
    };
  },

  computed: {
    hasSystemPreferences() {
      return !os.platform().startsWith('win');
    },
    availMemoryInGB() {
      return Math.ceil(os.totalmem() / 2 ** 30);
    },
    availNumCPUs() {
      return os.cpus().length;
    },
    cannotReset() {
      return ![K8s.State.STARTED, K8s.State.ERROR].includes(this.state);
    },
    notificationsList() {
      return Object.keys(this.notifications).map(key => ({
        key,
        message: this.notifications[key].message,
        color:   this.notifications[key].level,
      })).sort((left, right) => {
        return NotificationLevels.indexOf(left.color) - NotificationLevels.indexOf(right.color);
      });
    },
    hasError() {
      return Object.entries(this.notifications)
        ?.some(([_key, val]) => val.level === 'error');
    },
    /**
     * The version as saved in settings, as a semver (no v prefix).
     * @returns string
     */
    savedVersion() {
      return this.settings.kubernetes.version.replace(/^v/, '') || this.defaultVersion.version.version;
    },
    defaultVersion() {
      const version = this.recommendedVersions.find(v => (v.channels ?? []).includes('stable')
      );

      return (
        version ?? (this.recommendedVersions ?? this.nonRecommendedVersions)[0]
      );
    },
    /** Versions that are the tip of a channel */
    recommendedVersions() {
      return this.versions.filter(v => !!v.channels);
    },
    /** Versions that are not supported by a channel. */
    nonRecommendedVersions() {
      return this.versions.filter(v => !v.channels);
    },
  },

  created() {
    this.$store.dispatch(
      'page/setHeader',
      { title: this.t('k8s.title') }
    );
    if (this.hasSystemPreferences) {
      // We don't configure WSL metrics, so don't bother making these checks on Windows.
      if (this.settings.kubernetes.memoryInGB > this.availMemoryInGB) {
        alert(`Reducing memory size from ${ this.settings.kubernetes.memoryInGB } to ${ this.availMemoryInGB }`);
        this.settings.kubernetes.memoryInGB = this.availMemoryInGB;
      }
      if (this.settings.kubernetes.numberCPUs > this.availNumCPUs) {
        alert(`Reducing # of CPUs from ${ this.settings.kubernetes.numberCPUs } to ${ this.availNumCPUs }`);
        this.settings.kubernetes.numberCPUs = this.availNumCPUs;
      }
    }
  },

  mounted() {
    const that = this;

    ipcRenderer.on('k8s-check-state', (event, stt) => {
      that.$data.state = stt;
    });
    ipcRenderer.on('k8s-current-port', (event, port) => {
      this.currentPort = port;
    });
    ipcRenderer.on('k8s-current-engine', (event, engine) => {
      this.currentEngine = engine;
    });
    ipcRenderer.send('k8s-current-port');
    ipcRenderer.send('k8s-current-engine');
    ipcRenderer.on('k8s-restart-required', (event, required) => {
      console.log(`restart-required-all`, required);
      this.containerEngineChangePending = false;
      for (const key in required) {
        console.log(`restart-required`, key, required[key]);
        if (required[key].length > 0) {
          const message = `The cluster must be reset for ${ key } change from ${ required[key][0] } to ${ required[key][1] }.`;

          this.handleNotification('info', `restart-${ key }`, message);
          if (key === 'containerEngine') {
            this.containerEngineChangePending = true;
          }
        } else {
          this.handleNotification('info', `restart-${ key }`, '');
        }
      }
    });
    ipcRenderer.on('k8s-versions', (event, versions) => {
      this.versions = versions;
      if (versions.length === 0) {
        const message = 'No versions of Kubernetes were found';

        this.handleNotification('error', 'no-versions', message);
      } else if (!versions.some(v => v.version.version === this.savedVersion)) {
        const oldVersion = this.savedVersion;

        if (oldVersion) {
          const message = `Saved Kubernetes version v${ oldVersion } not available, using v${ this.defaultVersion.version.version }.`;

          this.handleNotification('info', 'invalid-version', message);
        }
        this.settings.kubernetes.version = this.defaultVersion.version.version;
      }
    });
    ipcRenderer.on('settings-update', (event, settings) => {
      // TODO: put in a status bar
      console.log('settings have been updated', settings);
      this.$data.settings = settings;
    });
    ipcRenderer.on('settings-read', (event, settings) => {
      this.$data.settings = settings;
    });
    ipcRenderer.send('settings-read');
    ipcRenderer.send('k8s-restart-required');
    ipcRenderer.send('k8s-versions');
  },

  methods: {
    /**
     * Reset a Kubernetes cluster to default at the same version
     * @param { 'auto' | 'wipe' } mode How to do the reset
     */
    reset(mode) {
      const wipe = this.containerEngineChangePending || mode === 'wipe' || this.state !== K8s.State.STARTED;
      const consequence = {
        true:  'Wiping Kubernetes will delete all workloads, configuration, and images.',
        false: 'Resetting Kubernetes will delete all workloads and configuration.',
      }[wipe];

      if (confirm(`${ consequence }\n\nDo you want to proceed?`)) {
        for (const key in this.notifications) {
          this.handleNotification('info', key, '');
        }
        this.state = K8s.State.STOPPING;
        ipcRenderer.send('k8s-reset', wipe ? 'wipe' : 'fast');
      }
    },
    restart() {
      this.state = K8s.State.STOPPING;
      ipcRenderer.send('k8s-restart');
    },
    onChange(event) {
      if (event.target.value !== this.settings.kubernetes.version) {
        let confirmationMessage = '';

        if (this.settings.kubernetes.port !== this.currentPort) {
          confirmationMessage = `Changing versions will require a full reset of Kubernetes (loss of workloads) because the desired port has also changed (from ${ this.currentPort } to ${ this.settings.kubernetes.port })`;
        } else if (semver.lt(event.target.value, this.settings.kubernetes.version)) {
          confirmationMessage = `Changing from version ${ this.settings.kubernetes.version } to ${ event.target.value } will reset Kubernetes.`;
        } else {
          confirmationMessage = `Changing from version ${ this.settings.kubernetes.version } to ${ event.target.value } will upgrade Kubernetes`;
        }
        confirmationMessage += '\n\nDo you want to proceed?';
        if (confirm(confirmationMessage)) {
          ipcRenderer.invoke('settings-write', { kubernetes: { version: event.target.value } })
            .then(() => this.restart());
        } else {
          alert('The Kubernetes version was not changed');
        }
      }
    },
    async onChangeEngine(desiredEngine) {
      if (desiredEngine !== this.settings.kubernetes.containerEngine) {
        const confirmationMessage = [`Changing container engines from ${ this.containerEngineNames[this.currentEngine] } to ${ this.containerEngineNames[desiredEngine] } will require a restart of Kubernetes.`,
          '\n\nDo you want to proceed?'].join('');

        if (confirm(confirmationMessage)) {
          try {
            await ipcRenderer.invoke('settings-write', { kubernetes: { containerEngine: desiredEngine } });
            this.restart();
          } catch (err) {
            console.log('invoke settings-write failed: ', err);
          }
        }
      }
    },
    /**
     * Get the display name of a given version.
     * @param {import('@/k8s-engine/k8s').VersionEntry} version The version to format.
     */
    versionName(version) {
      const names = (version.channels ?? []).filter(ch => !/^v?\d+/.test(ch));

      if (names.length > 0) {
        return `v${ version.version.version } (${ names.join(', ') })`;
      }

      return `v${ version.version.version }`;
    },
    handleUpdateMemory(value) {
      this.settings.kubernetes.memoryInGB = value;
      ipcRenderer.invoke('settings-write',
        { kubernetes: { memoryInGB: value } });
    },
    handleUpdateCPU(value) {
      this.settings.kubernetes.numberCPUs = value;
      ipcRenderer.invoke('settings-write',
        { kubernetes: { numberCPUs: value } });
    },
    handleUpdatePort(value) {
      this.settings.kubernetes.port = value;
      ipcRenderer.invoke('settings-write',
        { kubernetes: { port: value } });
    },
    handleUpdateFeatures(feature, value) {
      this.settings.kubernetes.options[feature] = value;
      ipcRenderer.invoke('settings-write',
        { kubernetes: { options: this.settings.kubernetes.options } });
    },
    handleNotification(level, key, message) {
      if (message) {
        this.$set(this.notifications, key, {
          key, level, message
        });
      } else {
        this.$delete(this.notifications, key);
      }
    },
    handleWarning(key, message) {
      this.handleNotification('warning', key, message);
    },
    handleError(key, message) {
      this.handleNotification('error', key, message);
    },
  },
};
</script>

<style scoped lang="scss">
.k8s-wrapper::v-deep .contents {
  padding-left: 1px;

  & > *:not(hr) {
    max-width: calc(100% - 20px);

    &:not(:first-child) {
      margin-top: 1.5em;
    }
  }
}

.select-k8s-version {
  width: inherit;
  display: inline-block;
}

.reset-kubernetes {
  display: flex;
}

.btn-reset {
  margin-right: 1rem;
}

.kubernetes-settings {
  display: grid;
  gap: 1em;
  grid-template-areas:
    "version  port"
    "features features";

  .feature {
    grid-area: features;
  }
}

.labeled-input {
  flex: 1;
  min-width: 16rem;
  margin: 1px; /* for the focus outline */
}
</style>
