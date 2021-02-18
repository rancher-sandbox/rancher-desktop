<!--
  - This is a component which displays notifications which will be stacked on
  - top of each other, in a bar above the rest of the content.
  -->
<template>
  <div class="stack">
    <slot />
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
    }
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
    }
  },
  methods: {
    close(key) {
      this.$set(this.closed, key, true);
    },
  }
};
</script>

<style scoped lang="scss">
  .stack {
    position: relative;
  }
  .banner-background {
    /* The banner background is normally tanslucent; to make sure it remains
     * readable, we manually set a background colour on the thing behind it. */
    background-color: var(--body-bg);
    position: absolute;
    top: 0;
    z-index: 1;
    padding: 0;
    margin: 15px 0;
  }
  .banner-background > .banner {
    margin: 0;
  }
</style>
