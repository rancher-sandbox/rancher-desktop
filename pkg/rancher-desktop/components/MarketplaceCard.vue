<template>
  <div class="extensions mt-10" @click="route">
    <div class="extensions-card">
      <div class="extensions-card-body">
        <span class="extensions-card-body-title">{{ extension.name }}</span>
        <span class="extensions-card-body-subtitle">{{
          extension.publisher.name
        }}</span>

        <span>{{ extension.short_description }}</span>
      </div>
      <div class="extensions-card-body-side">
        <img :src="extension.logo_url.small" alt="" />
      </div>
    </div>
    <div class="extension-card-footer"></div>
  </div>
</template>

<script>
export default {
  props: {
    extension: {
      type:     Object,
      required: true,
    },
  },

  methods: {
    route() {
      this.$router.push({
        name:   'marketplace-details',
        params: {
          slug:  this.extension.slug,
          image: this.extension.logo_url.small,
        },
      });
    },
  },
};
</script>

<style lang="scss" scoped>
.extensions {
  height: 100%;
  box-shadow: 0 0 10px 0 rgba(0, 0, 0, 0.1);
  border: 1px solid var(--muted);
  border-top: 4px solid var(--muted);
  transition: all 0.2s ease-in-out;
  padding: 10px;

  &:hover{
    cursor: pointer;
    border-color: var(--accent-btn-hover);
  }

  .extensions-card {
    display: flex;
    flex-direction: row;
    justify-content: space-between;
    align-items: center;

    &-body {
      display: flex;
      flex-direction: column;
      gap: 10px;
      justify-content: space-between;
      align-items: flex-start;

      &-title {
        font-size: 1.2rem;
        font-weight: 600;
      }

      &-subtitle {
        font-size: 0.8rem;
        font-weight: 400;
      }
    }

    img {
      width: 50px;
      height: 50px;
    }
  }
}
</style>
