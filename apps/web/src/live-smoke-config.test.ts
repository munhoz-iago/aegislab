import { describe, expect, it } from 'vitest';
import { resolveBaseUrl } from '../scripts/live-smoke-config.mjs';

describe('live browser target guard', () => {
  it('defaults to the local dashboard and accepts another loopback port', () => {
    expect(resolveBaseUrl()).toBe('http://127.0.0.1:5173');
    expect(resolveBaseUrl('http://localhost:5174')).toBe('http://localhost:5174');
  });

  it.each(['http://example.com', 'https://127.0.0.1:5173', 'http://127.0.0.1.example.com', 'http://127.0.0.1:5173/remote'])('rejects a nonlocal or non-origin target: %s', (value) => {
    expect(() => resolveBaseUrl(value)).toThrow(/loopback HTTP origin/);
  });
});
