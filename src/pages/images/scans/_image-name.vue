<template>
  <div>
    <div v-if="showImageOutput">
      <banner
        v-if="!imageManagerProcessIsFinished"
      >
        <loading-indicator>
          Scanning {{ image }}...
        </loading-indicator>
      </banner>
    </div>
  </div>
</template>

<script>
import LoadingIndicator from '@/components/LoadingIndicator.vue';
import Banner from '@/components/Banner.vue';

export default {
  name: 'images-scan-details',

  components: {
    LoadingIndicator,
    Banner
  },

  data() {
    return {
      image:                         this.$route.params.image,
      showImageOutput:               true,
      imageManagerProcessIsFinished: false
    };
  },

  mounted() {
    this.$store.dispatch(
      'page/setHeader',
      {
        title:  `${ this.$route.params.image } scan detail`,
        action: () => import(`@/components/ImagesScanDetailButtonExport.vue`)
      }
    );
  }
};
</script>
