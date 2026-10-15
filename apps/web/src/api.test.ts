import { describe, expect, it, vi } from 'vitest';
import { authenticate, friendlyError, getCurrentUser, logout } from './api';

describe('API client', () => {
  it('treats 401 from /me as a signed-out session', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: { code: 'unauthorized' } }), { status: 401 })));
    await expect(getCurrentUser()).resolves.toBeNull();
  });

  it('keeps credentials in same-origin authentication requests', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ user: { id: '1', email: 'x@example.test' } }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(authenticate('login', 'x@example.test', 'secure-password')).resolves.toEqual({ id: '1', email: 'x@example.test' });
    expect(fetchMock).toHaveBeenCalledWith('/api/auth/login', expect.objectContaining({ credentials: 'include', method: 'POST' }));
  });

  it('handles a bodyless logout and preserves API error details', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 204 })));
    await expect(logout()).resolves.toBeUndefined();

    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: { code: 'rate_limited', message: 'Too many requests' } }), { status: 429 })));
    await expect(authenticate('login', 'x@example.test', 'secure-password')).rejects.toMatchObject({ status: 429, code: 'rate_limited' });
  });

  it.each([
    [502, null, 'A API não está respondendo. Verifique se o serviço está ativo.'],
    [503, { error: { code: 'request_failed' } }, 'A API não está respondendo. Verifique se o serviço está ativo.'],
    [503, { error: { code: 'database_unavailable' } }, 'O banco de dados do laboratório está indisponível no momento. Tente novamente em alguns segundos.'],
    [500, { error: { code: 'internal_error' } }, 'O servidor encontrou um erro inesperado. Tente novamente em instantes.'],
    [403, { error: { code: 'origin_forbidden' } }, 'Este endereço não é aceito pela API. Abra o painel em http://127.0.0.1:5173.'],
  ])('provides actionable copy for HTTP %s', async (status, body, expected) => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(body ? JSON.stringify(body) : '', {
      status,
      headers: { 'Content-Type': body ? 'application/json' : 'text/plain' },
    })));
    await expect(authenticate('login', 'x@example.test', 'secure-password')).rejects.toSatisfy((error: unknown) => friendlyError(error) === expected);
  });

  it.each([[600, '10 minutos'], [30, '1 minuto']])('includes Retry-After %i seconds in 429 copy', async (seconds, phrase) => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: { code: 'rate_limited' } }), {
      status: 429,
      headers: { 'Retry-After': String(seconds) },
    })));
    try {
      await authenticate('login', 'x@example.test', 'secure-password');
      throw new Error('Expected 429');
    } catch (error) {
      expect(friendlyError(error)).toContain(phrase);
    }
  });
});
