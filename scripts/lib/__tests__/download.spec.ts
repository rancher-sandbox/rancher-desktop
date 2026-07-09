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
  const realFetch = global.fetch;

  beforeEach(() => {
    jest.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    global.fetch = realFetch;
    jest.restoreAllMocks();
  });

  it('retries a transient ECONNRESET and returns the eventual response', async() => {
    const response = { ok: true } as Response;
    const fetchMock = jest.fn<typeof fetch>()
      .mockRejectedValueOnce(fetchFailed('ECONNRESET'))
      .mockResolvedValueOnce(response);

    global.fetch = fetchMock;

    await expect(fetchWithRetry('https://example.test/x', { baseDelayMs: 0 })).resolves.toBe(response);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('retries when the retryable code is nested deeper in the cause chain', async() => {
    const response = { ok: true } as Response;
    const nested = Object.assign(new TypeError('fetch failed'), {
      cause: Object.assign(new Error('proxy error'), { cause: fetchFailed('ECONNRESET').cause }),
    });
    const fetchMock = jest.fn<typeof fetch>()
      .mockRejectedValueOnce(nested)
      .mockResolvedValueOnce(response);

    global.fetch = fetchMock;

    await expect(fetchWithRetry('https://example.test/x', { baseDelayMs: 0 })).resolves.toBe(response);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('does not retry a non-transient error', async() => {
    const fatal = fetchFailed('CERT_HAS_EXPIRED');
    const fetchMock = jest.fn<typeof fetch>().mockRejectedValue(fatal);

    global.fetch = fetchMock;

    await expect(fetchWithRetry('https://example.test/x', { baseDelayMs: 0 })).rejects.toBe(fatal);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('gives up after exhausting the retry budget', async() => {
    const fetchMock = jest.fn<typeof fetch>().mockRejectedValue(fetchFailed('ECONNRESET'));

    global.fetch = fetchMock;

    await expect(fetchWithRetry('https://example.test/x', { retries: 2, baseDelayMs: 0 })).rejects.toThrow('fetch failed');
    expect(fetchMock).toHaveBeenCalledTimes(3); // 1 initial attempt + 2 retries
  });
});
