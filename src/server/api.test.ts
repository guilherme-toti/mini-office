import { describe, expect, it } from 'vitest';
import { isLocalHost } from './api.ts';

describe('host check', () => {
  it('accepts this machine by name, with or without a port', () => {
    for (const host of ['127.0.0.1:5199', 'localhost:4321', 'localhost', '[::1]:4321']) {
      expect(isLocalHost(host), host).toBe(true);
    }
  });

  it('refuses any other host, as a DNS-rebinding page would send', () => {
    for (const host of [
      undefined,
      '',
      'evil.example:4321',
      '127.0.0.1.evil.example',
      'localhost.evil',
    ]) {
      expect(isLocalHost(host), String(host)).toBe(false);
    }
  });
});
