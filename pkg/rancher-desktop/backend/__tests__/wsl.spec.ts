import WSLBackend from '../wsl';

describe('WSLBackend', () => {
  describe('getIPAddress', () => {
    const route = `
      Iface   Destination     Gateway         Flags   RefCnt  Use     Metric  Mask            MTU     Window  IRTT
      eth0    00000000        01F019AC        0003    0       0       0       00000000        0       0       0
      docker0 000011AC        00000000        0001    0       0       0       0000FFFF        0       0       0
      eth0    00F019AC        00000000        0001    0       0       0       00F0FFFF        0       0       0
    `;
    const trie = `
        +-- 0.0.0.0/0 3 0 5
          |-- 0.0.0.0
              /0 universe UNICAST
          +-- 127.0.0.0/8 2 0 2
              +-- 127.0.0.0/31 1 0 0
                |-- 127.0.0.0
                    /8 host LOCAL
                |-- 127.0.0.1
                    /32 host LOCAL
              |-- 127.255.255.255
                /32 link BROADCAST
          +-- 172.16.0.0/12 2 0 2
              +-- 172.17.0.0/16 2 0 2
                +-- 172.17.0.0/31 1 0 0
                    |-- 172.17.0.0
                      /16 link UNICAST
                    |-- 172.17.0.1
                      /32 host LOCAL
                |-- 172.17.255.255
                    /32 link BROADCAST
              +-- 172.25.240.0/20 2 0 2
                +-- 172.25.240.0/23 2 0 2
                    |-- 172.25.240.0
                      /20 link UNICAST
                    |-- 172.25.241.207
                      /32 host LOCAL
                |-- 172.25.255.255
                    /32 link BROADCAST
    `;

    it('should return an IP address', async() => {
      function readFile(fileName: string): Promise<string> {
        if (fileName === '/proc/net/route') {
          return Promise.resolve(route);
        }
        if (fileName === '/proc/net/fib_trie') {
          return Promise.resolve(`Main:\n${ trie }Local:\n${ trie }`);
        }

        return Promise.reject(new Error(`Read unexpected file ${ fileName }`));
      }
      const expected = '172.25.241.207';
      const actual = WSLBackend.prototype['getIPAddress'].call(null, readFile);

      await expect(actual).resolves.toEqual(expected);
    });
    it('should accept non-standard network interface name', async() => {
      function readFile(fileName: string): Promise<string> {
        if (fileName === '/proc/net/route') {
          return Promise.resolve(route.replaceAll('eth0', 'eth3'));
        }
        if (fileName === '/proc/net/fib_trie') {
          return Promise.resolve(`Main:\n${ trie }Local:\n${ trie }`);
        }

        return Promise.reject(new Error(`Read unexpected file ${ fileName }`));
      }
      const expected = '172.25.241.207';
      const actual = WSLBackend.prototype['getIPAddress'].call(null, readFile);

      await expect(actual).resolves.toEqual(expected);
    });
  });
});
