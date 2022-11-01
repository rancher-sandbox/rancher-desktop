/**
 * This middleware redirects / to /General
 */
export default ({ route, next, redirect }) => {
  switch (route.path) {
  case process.env.RD_ENV_PLUGINS_DEV:
    next();
    break;
  case '/':
    redirect(301, '/General');
    break;
  default:
    next();
  }
};
