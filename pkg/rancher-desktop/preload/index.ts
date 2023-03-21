import initExtensions from './extensions';

async function init() {
  await initExtensions();
}

init().catch((ex) => {
  console.error(ex);
  throw ex;
});
