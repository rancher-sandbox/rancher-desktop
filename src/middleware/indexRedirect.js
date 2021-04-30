/**
 * This middleware redirects / to /General
 */
export default ({ route, next, redirect }) => {
  switch (route.path) {
  case '/':
    redirect(301, '/General');
    break;
  default:
    next();
  }
};
