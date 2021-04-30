<template>
  <div>
    <Images
      class="content"
      :images="images"
      :k8s-state="state"
      :show-all="settings.images.showAll"
      @toggledShowAll="onShowAllImagesChanged"
    />
  </div>
</template>

<script>
import Images from '@/components/Images.vue';
import { ipcRenderer } from 'electron';

export default {
  components: { Images },
  data() {
    return {
      settings:      ipcRenderer.sendSync('settings-read'),
      state:         ipcRenderer.sendSync('k8s-state'),
      images:        [],
    };
  },

  mounted() {
    ipcRenderer.on('images-changed', (event, images) => {
      this.$data.images = images;
    });
    ipcRenderer.on('k8s-check-state', (event, state) => {
      this.$data.state = state;
    });
    ipcRenderer.on('settings-update', (event, settings) => {
      // TODO: put in a status bar
      this.$data.settings = settings;
    });
    ipcRenderer.invoke('images-fetch')
      .then((images) => {
        this.$data.images = images;
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
