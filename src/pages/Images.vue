<template>
  <div>
    <Images
      class="content"
      :images="images"
      :state="state"
      :show-all="settings.images.showAll"
      @toggledShowAll="onShowAllImagesChanged"
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
      settings:      ipcRenderer.sendSync('settings-read'),
      k8sState:      ipcRenderer.sendSync('k8s-state'),
      kimState:      false,
      images:        [],
    };
  },

  computed: {
    state() {
      if (this.k8sState !== K8s.State.STARTED) {
        return 'K8S_UNREADY';
      }

      return this.kimState ? 'READY' : 'KIM_UNREADY';
    }
  },

  mounted() {
    ipcRenderer.on('images-changed', (event, images) => {
      this.$data.images = images;
    });
    ipcRenderer.on('k8s-check-state', (event, state) => {
      this.$data.k8sState = state;
    });
    ipcRenderer.on('images-check-state', (event, state) => {
      this.kimState = state;
    });
    ipcRenderer.on('settings-update', (event, settings) => {
      // TODO: put in a status bar
      this.$data.settings = settings;
    });
    ipcRenderer.invoke('images-fetch')
      .then((images) => {
        this.$data.images = images;
      });
    ipcRenderer.invoke('images-check-state')
      .then((/** @type boolean */ state) => {
        this.$data.kimState = state;
      });
  },

  methods: {
    onShowAllImagesChanged(value) {
      if (value !== this.settings.images.showAll) {
        ipcRenderer.invoke('settings-write',
          { images: { showAll: value } } );
      }
    },
  }

};
</script>

<style scoped>
.content {
  padding: 20px;
}
</style>
