<script>
export default {
  props: {
    color: {
      type:    String,
      default: 'secondary'
    },
    label: {
      type:    [String, Error],
      default: null,
    },
    labelKey: {
      type:    String,
      default: null,
    },
    closable: {
      type:    Boolean,
      defualt: false,
    }
  }
};
</script>
<template>
  <div class="banner" :class="{[color]: true, closable}">
    <slot>
      <t v-if="labelKey" :k="labelKey" :raw="true" />
      <template v-else>
        {{ label }}
      </template>
    </slot>
    <div v-if="closable" class="closer" @click="$emit('close')">
      <i class="icon icon-2x icon-close" />
    </div>
  </div>
</template>

<style lang="scss" scoped>
  .banner {
    padding: 10px;
    margin: 15px 0;
    width: 100%;
    border-radius: var(--border-radius);
    transition: all 0.2s ease;
    position: relative;

    &.closable {
      padding-right: 40px;
    }

    .closer {
      cursor: pointer;
      position: absolute;
      top: 0;
      right: 0;
      bottom: 0;
      width: 40px;
      line-height: 42px;
      text-align: center;
    }

    &.primary {
      background: var(--primary);
      border: solid 1px var(--primary);
      color: var(--body-text);
    }

    &.secondary {
      background: var(--secondary-banner-bg);
      border: solid 1px var(--secondary);
      color: var(--body-text);
    }

    &.success {
      background: var(--success-banner-bg);
      border: solid 1px var(--success);
      color: var(--body-text);
    }

    &.info {
      background: var(--info-banner-bg);
      border: solid 1px var(--info);
      color: var(--body-text);
    }

    &.warning {
      background: var(--warning-banner-bg);
      border: solid 1px var(--warning);
      color: var(--body-text);
    }

    &.error {
      background: var(--error-banner-bg);
      border: solid 1px var(--error);
      color: var(--error);
    }
  }
</style>
