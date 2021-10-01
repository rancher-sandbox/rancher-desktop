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
    this.$store.dispatch(
      'page/setHeader',
      { title: this.t('images.title') }
    );
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
    (async() => {
      this.$data.images = await ipcRenderer.invoke('images-mounted', true);
    })();
    (async() => {
      this.$data.kimState = await ipcRenderer.invoke('images-check-state');
    })();
  },

  beforeDestroy() {
    ipcRenderer.invoke('images-mounted', false);
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
