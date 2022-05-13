import { HttpCredentialHelperServer } from '../httpCredentialHelperServer';

const subject = new HttpCredentialHelperServer();

describe(HttpCredentialHelperServer, () => {
  describe('server', () => {
    it("should complain when the named helper utility doesn't exist", async() => {
      await expect(subject['runWithInput']('', 'no-such-helper', ['list'])).rejects
        .toHaveProperty('stderr', 'Error: spawn no-such-helper ENOENT');
    });
  });
});
