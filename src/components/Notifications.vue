<!--
  - This is a component which displays notifications which will be stacked on
  - top of each other, in a bar above the rest of the content.
  -->
<template>
  <div class="stack">
    <div class="contents">
      <slot />
    </div>
    <div class="banner-background">
      <Banner
        v-for="item in items"
        :key="item.key"
        :color="item.color"
        :closable="true"
        class="banner"
        @close="close(item.key)"
      >
        {{ item.message }}
      </Banner>
    </div>
  </div>
</template>

<script>
import Banner from '@/components/Banner.vue';
export default {
  components: { Banner },
  props:      {
    notifications: {
      type: Array,
      default() {
        return [];
      },
      validator(values) {
        return values.every(value => value.key && value.color && value.message);
      },
    },
  },
  data() {
    return { closed: {} };
  },
  computed: {
    items() {
      // Remove closed marker for any notifications that no longer exist, so
      // that they will show up again if they get re-added.
      for (const key of Object.keys(this.closed)) {
        if (!this.notifications.some(item => item.key === key)) {
          this.$delete(this.closed, key);
        }
      }

      return this.notifications.filter(v => !this.closed[v.key]);
    },
  },
  methods: {
    close(key) {
      this.$set(this.closed, key, true);
    },
  },
};
</script>

<style scoped lang="scss">
  .stack {
    display: flex;
    flex-direction: column;
  }
  .contents {
    flex: 1;
  }
  .banner-background {
    flex: none;
  }
</style>
