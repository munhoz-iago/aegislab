import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { StrictMode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { App } from './App';

const demoDashboard = {
  status: 'foundation',
  note: 'Base local disponível. Scanners ainda não foram integrados.',
  modules: [
    { id: 'demo', label: 'Aplicação de demonstração', status: 'available' },
    { id: 'security', label: 'Segurança', status: 'planned' },
  ],
};

function response(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

describe('AegisLab interface', () => {
  it('allows local sign in and shows only module states returned by the API', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === '/api/auth/me') return response({ error: { code: 'unauthorized', message: 'Authentication required' } }, 401);
      if (url === '/api/auth/login') {
        expect(init?.credentials).toBe('include');
        expect(JSON.parse(String(init?.body))).toEqual({ email: 'analista@example.test', password: 'strong-password-123' });
        return response({ user: { id: 'user-1', email: 'analista@example.test' } });
      }
      if (url === '/api/dashboard') return response(demoDashboard);
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);
    render(<App />);

    const user = userEvent.setup();
    fireEvent.change(await screen.findByRole('textbox', { name: 'E-mail' }), { target: { value: 'analista@example.test' } });
    fireEvent.change(screen.getByLabelText('Senha'), { target: { value: 'strong-password-123' } });
    await user.click(screen.getByRole('button', { name: 'Entrar no laboratório' }));

    expect(await screen.findByRole('heading', { name: 'Painel de engenharia' })).toBeTruthy();
    expect(screen.getByText('Base local disponível. Scanners ainda não foram integrados.')).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Aplicação de demonstração' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Segurança' })).toBeTruthy();
    expect(screen.getByText('Planejado')).toBeTruthy();
    expect(screen.queryByText(/requisições por segundo/i)).toBeNull();
  });

  it('shows a duplicate-account error without leaving the registration form', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      if (String(input) === '/api/auth/me') return response({ error: { code: 'unauthorized' } }, 401);
      if (String(input) === '/api/auth/register') return response({ error: { code: 'email_in_use', message: 'Email already registered' } }, 409);
      throw new Error(`Unexpected request: ${String(input)}`);
    }));
    render(<App />);

    const user = userEvent.setup();
    const accessOptions = await screen.findByRole('group', { name: 'Tipo de acesso' });
    await user.click(within(accessOptions).getByRole('button', { name: 'Criar conta' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'E-mail' }), { target: { value: 'analista@example.test' } });
    fireEvent.change(screen.getByLabelText('Senha'), { target: { value: 'strong-password-123' } });
    await user.click(within(screen.getByRole('form', { name: 'Formulário de acesso' })).getByRole('button', { name: 'Criar conta' }));

    expect((await screen.findByRole('alert')).textContent).toContain('Este e-mail já possui uma conta');
    expect(screen.getByRole('heading', { name: 'Crie seu acesso ao laboratório.' })).toBeTruthy();
  });

  it('restores a session and recovers from a temporary dashboard error', async () => {
    let dashboardCalls = 0;
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      if (String(input) === '/api/auth/me') return response({ user: { id: 'user-1', email: 'analista@example.test' } });
      if (String(input) === '/api/dashboard') {
        dashboardCalls += 1;
        return dashboardCalls === 1 ? response({ error: { code: 'request_failed' } }, 503) : response(demoDashboard);
      }
      throw new Error(`Unexpected request: ${String(input)}`);
    }));
    render(<App />);

    expect(await screen.findByRole('heading', { name: 'O painel não pôde ser carregado.' })).toBeTruthy();
    await userEvent.setup().click(screen.getByRole('button', { name: 'Tentar novamente' }));
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Aplicação de demonstração' })).toBeTruthy());
    expect(dashboardCalls).toBe(2);
  });

  it('returns to sign in when a dashboard request loses authorization', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      if (String(input) === '/api/auth/me') return response({ user: { id: 'user-1', email: 'analista@example.test' } });
      if (String(input) === '/api/dashboard') return response({ error: { code: 'unauthorized' } }, 401);
      throw new Error(`Unexpected request: ${String(input)}`);
    }));
    render(<App />);

    expect(await screen.findByRole('heading', { name: 'Entre na sua área de trabalho.' })).toBeTruthy();
    expect(screen.getByRole('alert').textContent).toContain('Sua sessão expirou. Entre novamente.');
    expect(screen.queryByRole('button', { name: 'Tentar novamente' })).toBeNull();
  });

  it('clears a login error after switching to registration', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      if (String(input) === '/api/auth/me') return response({ error: { code: 'unauthorized' } }, 401);
      if (String(input) === '/api/auth/login') return response({ error: { code: 'invalid_credentials' } }, 401);
      throw new Error(`Unexpected request: ${String(input)}`);
    }));
    render(<App />);

    const user = userEvent.setup();
    fireEvent.change(await screen.findByRole('textbox', { name: 'E-mail' }), { target: { value: 'analista@example.test' } });
    fireEvent.change(screen.getByLabelText('Senha'), { target: { value: 'strong-password-123' } });
    await user.click(screen.getByRole('button', { name: 'Entrar no laboratório' }));
    expect((await screen.findByRole('alert')).textContent).toContain('E-mail ou senha incorretos.');
    await user.click(screen.getByRole('button', { name: /^Criar conta$/ }));
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it.each([204, 500])('handles logout HTTP %i without losing the current view on failure', async (status) => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      if (String(input) === '/api/auth/me') return response({ user: { id: 'user-1', email: 'analista@example.test' } });
      if (String(input) === '/api/dashboard') return response(demoDashboard);
      if (String(input) === '/api/auth/logout') return status === 204 ? new Response(null, { status }) : response({ error: { code: 'internal_error' } }, status);
      throw new Error(`Unexpected request: ${String(input)}`);
    }));
    render(<App />);

    await screen.findByRole('heading', { name: 'Painel de engenharia' });
    await userEvent.setup().click(screen.getByRole('button', { name: 'Sair da conta' }));
    if (status === 204) {
      expect(await screen.findByRole('heading', { name: 'Entre na sua área de trabalho.' })).toBeTruthy();
    } else {
      expect((await screen.findByRole('alert')).textContent).toContain('O servidor encontrou um erro inesperado.');
      expect(screen.getByRole('heading', { name: 'Painel de engenharia' })).toBeTruthy();
    }
  });

  it('recovers the session check after a connection failure', async () => {
    let calls = 0;
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      if (String(input) !== '/api/auth/me') throw new Error(`Unexpected request: ${String(input)}`);
      calls += 1;
      if (calls === 1) throw new Error('connection unavailable');
      return response({ error: { code: 'unauthorized' } }, 401);
    }));
    render(<App />);

    expect(await screen.findByRole('heading', { name: 'Não foi possível verificar a sessão.' })).toBeTruthy();
    await userEvent.setup().click(screen.getByRole('button', { name: 'Tentar novamente' }));
    expect(await screen.findByRole('heading', { name: 'Entre na sua área de trabalho.' })).toBeTruthy();
    expect(calls).toBe(2);
  });

  it('moves focus and updates the title after sign in and logout', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      if (String(input) === '/api/auth/me') return response({ error: { code: 'unauthorized' } }, 401);
      if (String(input) === '/api/auth/login') return response({ user: { id: 'user-1', email: 'analista@example.test' } });
      if (String(input) === '/api/dashboard') return response({ ...demoDashboard, modules: [demoDashboard.modules[0]] });
      if (String(input) === '/api/auth/logout') return new Response(null, { status: 204 });
      throw new Error(`Unexpected request: ${String(input)}`);
    }));
    render(<App />);

    const user = userEvent.setup();
    fireEvent.change(await screen.findByRole('textbox', { name: 'E-mail' }), { target: { value: 'analista@example.test' } });
    fireEvent.change(screen.getByLabelText('Senha'), { target: { value: 'strong-password-123' } });
    await user.click(screen.getByRole('button', { name: 'Entrar no laboratório' }));
    const heading = await screen.findByRole('heading', { name: 'Painel de engenharia' });
    await waitFor(() => expect(document.activeElement).toBe(heading));
    expect(document.title).toBe('Painel — AegisLab');
    expect(await screen.findByText('1 módulo')).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Fundação' })).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Sair da conta' }));
    expect(await screen.findByRole('heading', { name: 'Entre na sua área de trabalho.' })).toBeTruthy();
    expect(document.title).toBe('Entrar — AegisLab');
    expect(screen.getByRole('status').textContent).toBe('Sessão encerrada.');
  });

  it('validates email and password length before making a request and describes the password rule', async () => {
    const fetchMock = vi.fn(async () => response({ error: { code: 'unauthorized' } }, 401));
    vi.stubGlobal('fetch', fetchMock);
    render(<App />);

    const user = userEvent.setup();
    const email = await screen.findByRole('textbox', { name: 'E-mail' });
    const password = screen.getByLabelText('Senha');
    expect(password.getAttribute('aria-describedby')).toContain('password-hint');
    const toggle = screen.getByRole('button', { name: 'Mostrar senha' });
    expect(toggle.getAttribute('aria-pressed')).toBe('false');
    await user.click(toggle);
    expect(toggle.getAttribute('aria-pressed')).toBe('true');

    fireEvent.change(email, { target: { value: 'ana@lab' } });
    fireEvent.change(password, { target: { value: 'strong-password-123' } });
    await user.click(screen.getByRole('button', { name: 'Entrar no laboratório' }));
    expect(screen.getByRole('alert').textContent).toContain('Informe um e-mail válido');
    expect(email.getAttribute('aria-invalid')).toBe('true');
    expect(fetchMock).toHaveBeenCalledTimes(1);

    fireEvent.change(email, { target: { value: 'ana@example.test' } });
    fireEvent.change(password, { target: { value: 'x'.repeat(129) } });
    await user.click(screen.getByRole('button', { name: 'Entrar no laboratório' }));
    expect(screen.getByRole('alert').textContent).toContain('A senha deve ter no máximo 128 caracteres.');
    expect(password.getAttribute('aria-invalid')).toBe('true');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('shows a neutral label for an unknown API module state', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      if (String(input) === '/api/auth/me') return response({ user: { id: 'user-1', email: 'analista@example.test' } });
      if (String(input) === '/api/dashboard') return response({ ...demoDashboard, modules: [{ id: 'new', label: 'Novo módulo', status: 'experimental' }] });
      throw new Error(`Unexpected request: ${String(input)}`);
    }));
    render(<App />);

    expect(await screen.findByText('Estado não reconhecido')).toBeTruthy();
    expect(screen.getByText('Estado informado pela API sem descrição conhecida')).toBeTruthy();
  });

  it('ignores the first StrictMode session check after a later check and successful login', async () => {
    const firstCheck = deferred<Response>();
    let checkCalls = 0;
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      if (String(input) === '/api/auth/me') {
        checkCalls += 1;
        return checkCalls === 1 ? firstCheck.promise : response({ error: { code: 'unauthorized' } }, 401);
      }
      if (String(input) === '/api/auth/login') return response({ user: { id: 'user-1', email: 'analista@example.test' } });
      if (String(input) === '/api/dashboard') return response(demoDashboard);
      throw new Error(`Unexpected request: ${String(input)}`);
    }));
    render(<StrictMode><App /></StrictMode>);

    fireEvent.change(await screen.findByRole('textbox', { name: 'E-mail' }), { target: { value: 'analista@example.test' } });
    fireEvent.change(screen.getByLabelText('Senha'), { target: { value: 'strong-password-123' } });
    await userEvent.setup().click(screen.getByRole('button', { name: 'Entrar no laboratório' }));
    expect(await screen.findByRole('heading', { name: 'Aplicação de demonstração' })).toBeTruthy();

    await act(async () => { firstCheck.resolve(response({ error: { code: 'unauthorized' } }, 401)); });
    expect(screen.getByRole('heading', { name: 'Painel de engenharia' })).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'Entre na sua área de trabalho.' })).toBeNull();
    expect(checkCalls).toBe(2);
  });

  it.each([200, 401])('ignores an old dashboard HTTP %i response after logout and another login', async (oldStatus) => {
    const oldDashboard = deferred<Response>();
    let dashboardCalls = 0;
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input);
      if (path === '/api/auth/me') return response({ error: { code: 'unauthorized' } }, 401);
      if (path === '/api/auth/login') {
        const { email } = JSON.parse(String(init?.body)) as { email: string };
        return response({ user: { id: email, email } });
      }
      if (path === '/api/auth/logout') return new Response(null, { status: 204 });
      if (path === '/api/dashboard') {
        dashboardCalls += 1;
        return dashboardCalls === 1 ? oldDashboard.promise : response({ ...demoDashboard, note: 'Painel da nova sessão.' });
      }
      throw new Error(`Unexpected request: ${path}`);
    }));
    render(<App />);

    const user = userEvent.setup();
    fireEvent.change(await screen.findByRole('textbox', { name: 'E-mail' }), { target: { value: 'antigo@example.test' } });
    fireEvent.change(screen.getByLabelText('Senha'), { target: { value: 'strong-password-123' } });
    await user.click(screen.getByRole('button', { name: 'Entrar no laboratório' }));
    await screen.findByRole('heading', { name: 'Painel de engenharia' });
    await user.click(screen.getByRole('button', { name: 'Sair da conta' }));
    fireEvent.change(await screen.findByRole('textbox', { name: 'E-mail' }), { target: { value: 'novo@example.test' } });
    fireEvent.change(screen.getByLabelText('Senha'), { target: { value: 'strong-password-123' } });
    await user.click(screen.getByRole('button', { name: 'Entrar no laboratório' }));
    expect(await screen.findByText('Painel da nova sessão.')).toBeTruthy();

    await act(async () => {
      oldDashboard.resolve(oldStatus === 401
        ? response({ error: { code: 'unauthorized' } }, 401)
        : response({ ...demoDashboard, note: 'Painel da sessão antiga.' }));
    });
    expect(screen.getByText('Painel da nova sessão.')).toBeTruthy();
    expect(screen.queryByText('Painel da sessão antiga.')).toBeNull();
    expect(screen.getByText('novo@example.test')).toBeTruthy();
    expect(dashboardCalls).toBe(2);
  });
});
