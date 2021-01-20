<template>
  <nav>
    <ul>
        <li v-bind:item="item" v-bind:key="item.name" v-for="item in items">
            <router-link :to="item.path">{{ item.component.title }}</router-link>
        </li>
    </ul>
  </nav>
</template>

<script>
export default {
    props: ['items'],
}
</script>

<!-- Add "scoped" attribute to limit CSS to this component only -->
<style scoped lang="scss">

nav {
    background-color: var(--nav-bg);
    height: 91vh;
    padding: 0;
    margin: 0;
    padding-top: 20px;
}

ul {
    margin: 0;
    padding: 0;
    list-style-type: none;

    li {
        padding: 0;

        A {
            color: var(--link-text);
            text-decoration: none;
            line-height: 24px;
            padding: 7.5px 10px;
            letter-spacing: 1.4px;
            display: block;
            outline: none;
        }

        A.router-link-exact-active {
            background-color: var(--nav-active);
            border-left: 5px solid var(--primary);
            color: var(--body-text);
        }
    }
}

</style>
