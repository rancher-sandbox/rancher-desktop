<template>
  <div>
    <Images
      class="content"
      :images="images"
    />
  </div>
</template>

<script>
import Images from '@/components/Images.vue';
import { ipcRenderer } from 'electron';

export default {
  components: { Images },
  data() {
    return { images: [] };
  },

  mounted() {
    ipcRenderer.on('images-changed', (event, images) => {
      this.$data.images = images;
    });
  },

};
</script>

<style scoped>
  .content {
    padding: 20px;
  }
</style>
