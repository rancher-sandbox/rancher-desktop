export default async function({
  isHMR, app, store, route, params, error, redirect
}) {
  // If middleware is called from hot module replacement, ignore it
  if (isHMR) {
    return;
  }

  await store.dispatch('i18n/init');
}
