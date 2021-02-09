<template>
  <header>
    <div alt="Logo" class="logo">
      <img src="@/assets/images/half-logo.svg">
    </div>
    <h1>Rancher Desktop</h1>
  </header>
</template>

<style lang="scss" scoped>
  header {
    height:  var(--header-height);
    background-color: var(--header-bg);
    position: relative;

    .logo {
    height: 30px;
    position: absolute;
    top: 9px;
    left: 0;
    z-index: 2;

        img {
            height: 30px;
        }
    }

    h1 {
        padding: 10px 0 0 45px;
        line-height: calc(var(--header-height) - 19px);
        color: var(--header-btn-text);
    }
  }
</style>
