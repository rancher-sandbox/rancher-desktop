/**
 * @jest-environment node
 */

import { jest } from '@jest/globals';

import { fetchWithRetry } from '../download';

/** Builds the error `fetch` throws when the socket drops mid-request. */
function fetchFailed(code: string): TypeError {
  return Object.assign(new TypeError('fetch failed'), {
    cause: Object.assign(new Error(`read ${ code }`), { code }),
  });
}

describe('fetchWithRetry', () => {
  let fetchSpy: jest.SpiedFunction<typeof global.fetch>;

  beforeEach(() => {
    jest.spyOn(console, 'log').mockImplementation(() => {});
    fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue({ ok: true } as Response);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('retries a transient ECONNRESET and returns the eventual response', async() => {
    const response = { ok: true } as Response;

    fetchSpy.mockRejectedValueOnce(fetchFailed('ECONNRESET')).mockResolvedValueOnce(response);

    await expect(fetchWithRetry('https://example.test/x', { baseDelayMs: 0 })).resolves.toBe(response);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it('retries when the retryable code is nested deeper in the cause chain', async() => {
    const response = { ok: true } as Response;
    const nested = Object.assign(new TypeError('fetch failed'), {
      cause: Object.assign(new Error('proxy error'), { cause: fetchFailed('ECONNRESET').cause }),
    });

    fetchSpy.mockRejectedValueOnce(nested).mockResolvedValueOnce(response);

    await expect(fetchWithRetry('https://example.test/x', { baseDelayMs: 0 })).resolves.toBe(response);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it('does not retry a non-transient error', async() => {
    const fatal = fetchFailed('CERT_HAS_EXPIRED');

    fetchSpy.mockRejectedValue(fatal);

    await expect(fetchWithRetry('https://example.test/x', { baseDelayMs: 0 })).rejects.toBe(fatal);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('gives up after exhausting the retry budget', async() => {
    fetchSpy.mockRejectedValue(fetchFailed('ECONNRESET'));

    await expect(fetchWithRetry('https://example.test/x', { retries: 2, baseDelayMs: 0 })).rejects.toThrow('fetch failed');
    expect(fetchSpy).toHaveBeenCalledTimes(3); // 1 initial attempt + 2 retries
  });
});
