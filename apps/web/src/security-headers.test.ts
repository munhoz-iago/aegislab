import { describe, expect, it } from 'vitest';
import { devSecurityHeaders, previewSecurityHeaders } from '../security-headers';

describe('dashboard security headers', () => {
  it('keeps the preview CSP free of inline and eval script exceptions', () => {
    const csp = previewSecurityHeaders['Content-Security-Policy'];
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).not.toContain('unsafe-inline');
    expect(csp).not.toContain('unsafe-eval');
    expect(previewSecurityHeaders['X-Content-Type-Options']).toBe('nosniff');
    expect(previewSecurityHeaders['Referrer-Policy']).toBe('no-referrer');
  });

  it('uses a minimal CSP for Vite development refresh', () => {
    expect(devSecurityHeaders['Content-Security-Policy']).toBe("frame-ancestors 'none'");
  });
});
