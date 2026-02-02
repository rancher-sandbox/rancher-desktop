<template>
  <div>
    <RouterView />
    <Images
      class="content"
      data-test="imagesTable"
      :images="images"
      :image-namespaces="imageNamespaces"
      :state="state"
      :show-all="settings.images.showAll"
      :selected-namespace="settings.images.namespace"
      :supports-namespaces="supportsNamespaces"
      :protected-images="protectedImages"
      @toggled-show-all="onShowAllImagesChanged"
      @switch-namespace="onChangeNamespace"
    />
  </div>
</template>

<script lang="ts">

import _ from 'lodash';
import { defineComponent } from 'vue';

import { State as K8sState } from '@pkg/backend/backend';
import Images from '@pkg/components/Images.vue';
import { defaultSettings } from '@pkg/config/settings';
import { mapTypedActions, mapTypedGetters, mapTypedMutations, mapTypedState } from '@pkg/entry/store';
import { IpcRendererEvents } from '@pkg/typings/electron-ipc';
import { ipcRenderer } from '@pkg/utils/ipcRenderer';

type Image = Parameters<IpcRendererEvents['images-changed']>[0][number];

enum ImageManagerStates {
  UNREADY = 'IMAGE_MANAGER_UNREADY',
  READY = 'READY',
}

export default defineComponent({
  components: { Images },
  data() {
    return {
      settings:           defaultSettings,
      images:             [] as Image[],
      imageNamespaces:    [] as string[],
      supportsNamespaces: true,
    };
  },

  computed: {
    state() {
      if ((window as any).imagesListMock) {
        // Override for screenshots
        return ImageManagerStates.READY;
      }

      if (![K8sState.STARTED, K8sState.DISABLED].includes(this.k8sState)) {
        return ImageManagerStates.UNREADY;
      }

      return this.imageManagerState ? ImageManagerStates.READY : ImageManagerStates.UNREADY;
    },
    rancherImages(): string[] {
      return this.images
        .map(image => image.imageName)
        .filter(name => name.startsWith('rancher/'));
    },
    installedExtensionImages(): string[] {
      return this.installedExtensions.map(image => image.id);
    },
    protectedImages(): string[] {
      return [
        'moby/buildkit',
        'ghcr.io/rancher-sandbox/rancher-desktop/rdx-proxy',
        ...this.rancherImages,
        ...this.installedExtensionImages,
      ];
    },
    ...mapTypedState('imageManager', ['imageManagerState']),
    ...mapTypedGetters('k8sManager', { k8sState: 'getK8sState' }),
    ...mapTypedGetters('extensions', ['installedExtensions']),
  },

  watch: {
    state: {
      handler(state: string) {
        this.setHeader({ title: this.t('images.title') });

        if (!state || state === ImageManagerStates.UNREADY) {
          return;
        }

        this.setAction({ action: 'ImagesButtonAdd' });
      },
      immediate: true,
    },
  },

  mounted() {
    ipcRenderer.on('images-changed', async(event, images) => {
      if ((window as any).imagesListMock) {
        // Override for screenshots
        images = await (window as any).imagesListMock();
      }
      if (_.isEqual(images, this.images)) {
        return;
      }

      this.images = images;

      if (this.supportsNamespaces && this.imageNamespaces.length === 0) {
        // This happens if the user clicked on the Images panel before data was ready,
        // so no namespaces were available when it initially asked for them.
        // When the data is ready, images are pushed in, but namespaces aren't.
        ipcRenderer.send('images-namespaces-read');
      }
    });

    ipcRenderer.on('images-check-state', (event, state: any) => {
      this.setImageManagerState(state);
    });

    ipcRenderer.invoke('images-check-state').then((state: any) => {
      this.setImageManagerState(state);
    });

    ipcRenderer.on('settings-update', (event, settings: any) => {
      // TODO: put in a status bar
      this.$data.settings = settings;
      this.checkSelectedNamespace();
    });

    (async() => {
      this.images = await ipcRenderer.invoke('images-mounted', true);
    })();

    ipcRenderer.on('images-namespaces', (event, namespaces: string[]) => {
      // TODO: Use a specific message to indicate whether or not messages are supported.
      this.imageNamespaces = namespaces;
      this.supportsNamespaces = namespaces.length > 0;
      this.checkSelectedNamespace();
    });
    ipcRenderer.send('images-namespaces-read');
    ipcRenderer.on('settings-read', (event, settings: any) => {
      this.settings = settings;
    });
    ipcRenderer.send('settings-read');

    ipcRenderer.on('extensions/changed', this.fetchExtensions);
    this.fetchExtensions();
  },
  beforeUnmount() {
    ipcRenderer.invoke('images-mounted', false);
    ipcRenderer.removeAllListeners('images-changed');
    ipcRenderer.removeListener('extensions/changed', this.fetchExtensions);
  },

  methods: {
    ...mapTypedActions('extensions', { fetchExtensions: 'fetch' }),
    ...mapTypedActions('page', ['setAction', 'setHeader']),
    ...mapTypedMutations('imageManager', { setImageManagerState: 'SET_IMAGE_MANAGER_STATE' }),
    checkSelectedNamespace() {
      if (!this.supportsNamespaces || this.imageNamespaces.length === 0) {
        // Nothing to verify yet
        return;
      }
      if (!this.imageNamespaces.includes(this.settings.images.namespace)) {
        const defaultNamespace = this.imageNamespaces.includes('default') ? 'default' : this.imageNamespaces[0];

        ipcRenderer.invoke('settings-write',
          { images: { namespace: defaultNamespace } } );
      }
    },
    onShowAllImagesChanged(value: boolean) {
      if (value !== this.settings.images.showAll) {
        ipcRenderer.invoke('settings-write',
          { images: { showAll: value } } );
      }
    },
    onChangeNamespace(value: string) {
      if (value !== this.settings.images.namespace) {
        ipcRenderer.invoke('settings-write',
          { images: { namespace: value } } );
      }
    },
  },
});
</script>
