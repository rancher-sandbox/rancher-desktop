import { HttpCredentialHelperServer } from '../httpCredentialHelperServer';

const subject = new HttpCredentialHelperServer();

describe(HttpCredentialHelperServer, () => {
  describe('server', () => {
    it("should complain when the named helper utility doesn't exist", async() => {
      await expect(() => subject['runWithInput']('', 'no-such-helper', ['list']))
        .rejects.toHaveProperty('code', 'ENOENT');
      // Skip testing for prop.path == 'no-such-helper' and prop.syscall == 'spawn no-such-helper'
    });
  });
});
