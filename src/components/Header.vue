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

    .logo {
    height: 40px;
    position: absolute;
    top: 8px;
    left: 0;
    z-index: 2;

        img {
            height: 40px;
            padding: 0 0 0 10px;
        }
    }

  }
</style>
