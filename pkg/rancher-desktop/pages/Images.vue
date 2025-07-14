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
      @toggledShowAll="onShowAllImagesChanged"
      @switchNamespace="onChangeNamespace"
    />
  </div>
</template>

<script>

import _ from 'lodash';
import { mapGetters } from 'vuex';

import { State as K8sState } from '@pkg/backend/backend';
import Images from '@pkg/components/Images.vue';
import { defaultSettings } from '@pkg/config/settings';
import { ipcRenderer } from '@pkg/utils/ipcRenderer';

const ImageMangerStates = Object.freeze({
  UNREADY: 'IMAGE_MANAGER_UNREADY',
  READY:   'READY',
});

export default {
  components: { Images },
  data() {
    return {
      settings:           defaultSettings,
      images:             [],
      imageNamespaces:    [],
      supportsNamespaces: true,
    };
  },

  computed: {
    state() {
      if (![K8sState.STARTED, K8sState.DISABLED].includes(this.k8sState)) {
        return ImageMangerStates.UNREADY;
      }

      return this.imageManagerState ? ImageMangerStates.READY : ImageMangerStates.UNREADY;
    },
    rancherImages() {
      return this.images
        .filter(image => image.imageName.startsWith('rancher/'))
        .map(image => image.imageName);
    },
    installedExtensionImages() {
      return this.installedExtensions.map(image => image.id);
    },
    protectedImages() {
      return [
        'moby/buildkit',
        'ghcr.io/rancher-sandbox/rancher-desktop/rdx-proxy',
        ...this.rancherImages,
        ...this.installedExtensionImages,
      ];
    },
    ...mapGetters('k8sManager', { k8sState: 'getK8sState' }),
    ...mapGetters('imageManager', { imageManagerState: 'getImageManagerState' }),
    ...mapGetters('extensions', ['installedExtensions']),
  },

  watch: {
    state: {
      handler(state) {
        this.$store.dispatch(
          'page/setHeader',
          { title: this.t('images.title') },
        );

        if (!state || state === ImageMangerStates.UNREADY) {
          return;
        }

        this.$store.dispatch(
          'page/setAction',
          { action: 'ImagesButtonAdd' },
        );
      },
      immediate: true,
    },
  },

  mounted() {
    ipcRenderer.on('images-changed', (event, images) => {
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

    ipcRenderer.on('images-check-state', (event, state) => {
      this.$store.dispatch('imageManager/setImageManagerState', state);
    });

    ipcRenderer.invoke('images-check-state').then((state) => {
      this.$store.dispatch('imageManager/setImageManagerState', state);
    });

    ipcRenderer.on('settings-update', (event, settings) => {
      // TODO: put in a status bar
      this.$data.settings = settings;
      this.checkSelectedNamespace();
    });

    (async() => {
      this.$data.images = await ipcRenderer.invoke('images-mounted', true);
    })();

    ipcRenderer.on('images-namespaces', (event, namespaces) => {
      // TODO: Use a specific message to indicate whether messages are supported or not.
      this.$data.imageNamespaces = namespaces;
      this.$data.supportsNamespaces = namespaces.length > 0;
      this.checkSelectedNamespace();
    });
    ipcRenderer.send('images-namespaces-read');
    ipcRenderer.on('settings-read', (event, settings) => {
      this.$data.settings = settings;
    });
    ipcRenderer.send('settings-read');

    ipcRenderer.on('extensions/changed', this.fetchExtensions);
    this.$store.dispatch('extensions/fetch');
  },
  beforeUnmount() {
    ipcRenderer.invoke('images-mounted', false);
    ipcRenderer.removeAllListeners('images-mounted');
    ipcRenderer.removeAllListeners('images-changed');
    ipcRenderer.removeListener('extensions/changed', this.fetchExtensions);
  },

  methods: {
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
    onShowAllImagesChanged(value) {
      if (value !== this.settings.images.showAll) {
        ipcRenderer.invoke('settings-write',
          { images: { showAll: value } } );
      }
    },
    onChangeNamespace(value) {
      if (value !== this.settings.images.namespace) {
        ipcRenderer.invoke('settings-write',
          { images: { namespace: value } } );
      }
    },
    fetchExtensions() {
      this.$store.dispatch('extensions/fetch');
    },
  },
};
</script>
