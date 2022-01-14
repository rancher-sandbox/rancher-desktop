<script>
import { ipcRenderer } from 'electron';

export default {
  name:    'header',
  methods: {
    closeDashboard() {
      ipcRenderer.send('dashboard-close');
    }
  }
};
</script>

<template>
  <header>
    <div alt="Rancher Desktop" class="logo">
      <img src="@/assets/images/logo.svg">
    </div>
  </header>
</template>

<style lang="scss" scoped>
  header {
    height:  var(--header-height);
    background-color: var(--header-bg);
    position: relative;
    display: flex;
    align-items: center;
    gap: 1rem;

    .logo {
    height: 40px;
    z-index: 2;

        img {
            height: 40px;
            padding: 0 0 0 10px;
        }
    }

  }
</style>
