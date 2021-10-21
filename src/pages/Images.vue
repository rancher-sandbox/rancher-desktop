<template>
  <div>
    <nuxt-child />
    <Images
      class="content"
      data-test="imagesTable"
      :images="images"
      :image-namespaces="imageNamespaces"
      :state="state"
      :show-all="settings.images.showAll"
      :selected-namespace="settings.images.namespace"
      @toggledShowAll="onShowAllImagesChanged"
      @switchNamespace="onChangeNamespace"
    />
  </div>
</template>

<script>
import { ipcRenderer } from 'electron';
import Images from '@/components/Images.vue';
import * as K8s from '@/k8s-engine/k8s';

export default {
  components: { Images },
  data() {
    return {
      settings:          ipcRenderer.sendSync('settings-read'),
      k8sState:          ipcRenderer.sendSync('k8s-state'),
      imageManagerState: false,
      images:            [],
      imageNamespaces:   [],
    };
  },

  computed: {
    state() {
      if (this.k8sState !== K8s.State.STARTED) {
        return 'IMAGE_MANAGER_UNREADY';
      }

      return this.imageManagerState ? 'READY' : 'IMAGE_MANAGER_UNREADY';
    }
  },

  mounted() {
    this.$store.dispatch(
      'page/setHeader',
      {
        title:  this.t('images.title'),
        action: 'images-button-add'
      }
    );
    ipcRenderer.on('images-changed', (event, images) => {
      this.$data.images = images;
      if (this.imageNamespaces.length === 0) {
        // This happens if the user clicked on the Images panel before data was ready,
        // so no namespaces were available when it initially asked for them.
        // When the data is ready, images are pushed in, but namespaces aren't.
        ipcRenderer.send('images-namespaces-read');
      }
    });
    ipcRenderer.on('k8s-check-state', (event, state) => {
      this.$data.k8sState = state;
    });
    ipcRenderer.on('images-check-state', (event, state) => {
      this.imageManagerState = state;
    });
    ipcRenderer.on('settings-update', (event, settings) => {
      // TODO: put in a status bar
      this.$data.settings = settings;
      this.checkSelectedNamespace();
    });
    (async() => {
      this.$data.images = await ipcRenderer.invoke('images-mounted', true);
    })();
    (async() => {
      this.$data.imageManagerState = await ipcRenderer.invoke('images-check-state');
    })();
    ipcRenderer.on('images-namespaces', (event, namespaces) => {
      this.$data.imageNamespaces = namespaces;
      this.checkSelectedNamespace();
    });
    ipcRenderer.send('images-namespaces-read');
  },
  beforeDestroy() {
    ipcRenderer.invoke('images-mounted', false);
  },

  methods: {
    checkSelectedNamespace() {
      if (this.imageNamespaces.length === 0) {
        // Nothing to verify yet
        return;
      }
      if (!this.imageNamespaces.includes(this.settings.images.namespace)) {
        const K8S_NAMESPACE = 'k8s.io';
        const defaultNamespace = this.imageNamespaces.includes(K8S_NAMESPACE) ? K8S_NAMESPACE : this.imageNamespaces[0];

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
    }
  }

};
</script>

<style scoped>
.content {
  padding: 20px;
}
</style>
