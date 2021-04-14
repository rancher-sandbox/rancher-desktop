<template>
  <div>
    <Images
      class="content"
      :images="images"
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
      images:   [],
    };
  },

  mounted() {
    ipcRenderer.on('images-changed', (event, images) => {
      this.$data.images = images;
    });
    ipcRenderer.on('settings-update', (event, settings) => {
      // TODO: put in a status bar
      this.$data.settings = settings;
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
