import { ipcRenderer } from '@pkg/utils/ipcRenderer';

export default function initDashboard(): void {
  if (!document.location.href.startsWith('https://localhost/dashboard/')) {
    return;
  }
  console.log('Will init dashboard!');
  async function onNavigate(event: Event) {
    console.log(`${ event.type }! -> ${ location.href }`);

    const resp = await fetch('https://localhost/v3/users?me=true');

    console.log(resp);
    if (resp.status === 401) {
      // Need to login
      const token = await ipcRenderer.invoke('dashboard/get-csrf-token') ?? '';
      await fetch("https://localhost/v3-public/localProviders/local?action=login", {
        headers: {
          'Accept': "application/json",
          'Content-Type': "application/json",
          'X-API-CSRF': token,
        },
        body: JSON.stringify({
          description: 'Rancher Desktop session',
          responseType: 'cookie',
          username: 'admin',
          password: 'password',
        }),
        method: "POST",
        credentials: "include"
      });
    }

    if (location.pathname === '/dashboard/auth/login') {
      console.log('Logging in!');
      /** Helper to evalute a singel XPath expression */
      function $x<T extends Element>(expr: string) {
        return document.evaluate(
          expr,
          document,
          null,
          XPathResult.FIRST_ORDERED_NODE_TYPE
          ).singleNodeValue as T;
      }
      $x<HTMLInputElement>('//*[@id="username"]/descendant-or-self:input').value = 'admin';
      $x<HTMLInputElement>('//*[@id="password"]/descendant-or-self:input').value = 'password';
      $x<HTMLButtonElement>('//*[@id=submit]').click();
    }
  }
  window.addEventListener('hashchange', onNavigate);
  window.addEventListener('pageshow', onNavigate);
  window.addEventListener('popstate', onNavigate);
}
