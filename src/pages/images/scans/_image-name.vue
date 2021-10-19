<template>
  <h1>NOT FAIL</h1>
</template>

<script>
export default {
  name: 'images-scan-details',
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
