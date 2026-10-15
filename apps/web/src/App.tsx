import { useEffect, useRef, useState, type FormEvent, type ReactNode, type RefObject } from 'react';
import {
  ApiError,
  authenticate,
  friendlyError,
  getCurrentUser,
  getDashboard,
  logout,
  type Dashboard,
  type DashboardModule,
  type User,
} from './api';

type SessionState =
  | { phase: 'checking'; user: null }
  | { phase: 'failed'; user: null }
  | { phase: 'signed-out'; user: null }
  | { phase: 'signed-in'; user: User };

type DashboardState =
  | { phase: 'idle'; data: null; error: null }
  | { phase: 'loading'; data: null; error: null }
  | { phase: 'failed'; data: null; error: string }
  | { phase: 'ready'; data: Dashboard; error: null };

function Brand({ compact = false }: { compact?: boolean }) {
  return (
    <div className="brand">
      <svg className="brand-mark" viewBox="0 0 40 40" fill="none" aria-hidden="true">
        <rect x="1" y="1" width="38" height="38" rx="10" stroke="currentColor" strokeOpacity=".7" />
        <path d="M10 27.5 19.7 11h.6L30 27.5M14.8 22h10.4M18.9 28h2.2" stroke="currentColor" strokeWidth="2.3" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      {!compact && <span>Aegis<span className="brand-light">Lab</span></span>}
    </div>
  );
}

function Icon({ name, className = '' }: { name: 'arrow' | 'eye' | 'eye-off' | 'logout' | 'refresh' | 'check'; className?: string }) {
  const paths: Record<typeof name, ReactNode> = {
    arrow: <><path d="M5 12h14" /><path d="m13 6 6 6-6 6" /></>,
    eye: <><path d="M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6Z" /><circle cx="12" cy="12" r="2.5" /></>,
    'eye-off': <><path d="m3 3 18 18" /><path d="M9.5 6.3a10.7 10.7 0 0 1 2.5-.3c6 0 9.5 6 9.5 6a16.4 16.4 0 0 1-3.1 3.5M6.2 6.9C3.9 8.5 2.5 12 2.5 12s3.5 6 9.5 6c1.4 0 2.7-.3 3.8-.9" /></>,
    logout: <><path d="M10 4H5a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h5" /><path d="M10 12h11m-4-4 4 4-4 4" /></>,
    refresh: <><path d="M20 11a8 8 0 1 0-1.7 5" /><path d="M20 4v7h-7" /></>,
    check: <path d="m4 12 5 5L20 6" />,
  };
  return <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>;
}

function AuthScreen({ onAuthenticate, onModeChange, busy, error, headingRef }: {
  onAuthenticate: (mode: 'login' | 'register', email: string, password: string) => Promise<void>;
  onModeChange: () => void;
  busy: boolean;
  error: string | null;
  headingRef: RefObject<HTMLHeadingElement | null>;
}) {
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [passwordVisible, setPasswordVisible] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fieldError, setFieldError] = useState<{ field: 'email' | 'password'; message: string } | null>(null);
  const visibleError = fieldError?.message ?? error;

  function changeMode(next: 'login' | 'register') {
    if (next === mode) return;
    setMode(next);
    setFieldError(null);
    onModeChange();
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const normalizedEmail = email.trim().toLowerCase();
    // Keep the local check aligned with parseCredentials in the API.
    if (normalizedEmail.length < 3 || normalizedEmail.length > 254 || !/^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?\.[a-z]{2,}$/i.test(normalizedEmail)) {
      setFieldError({ field: 'email', message: 'Informe um e-mail válido, como voce@exemplo.com.' });
      return;
    }
    if (password.length > 128) {
      setFieldError({ field: 'password', message: 'A senha deve ter no máximo 128 caracteres.' });
      return;
    }
    if (password.length < 12) {
      setFieldError({ field: 'password', message: 'A senha deve ter pelo menos 12 caracteres.' });
      return;
    }
    setFieldError(null);
    void onAuthenticate(mode, normalizedEmail, password);
  }

  return (
    <main className="auth-layout">
      <section className="auth-intro" aria-labelledby="intro-title">
        <div className="intro-content">
          <Brand />
          <div className="intro-message">
            <p className="section-caption">Laboratório open source</p>
            <h1 id="intro-title">Experimentos com escopo. Evidências que podem ser repetidas.</h1>
            <p className="intro-copy">Uma base de engenharia para estudar segurança, desempenho e observabilidade em ambientes controlados.</p>
          </div>
          <div className="protocol-strip" aria-label="Protocolo do laboratório">
            <span>Defina o alvo autorizado</span>
            <span>Estabeleça limites</span>
            <span>Registre o resultado</span>
          </div>
        </div>
        <div className="intro-grid" aria-hidden="true" />
      </section>

      <section className="auth-side" aria-labelledby="auth-title">
        <div className="auth-box">
          <p className="auth-overline">Acesso ao laboratório</p>
          <h2 id="auth-title" ref={headingRef} tabIndex={-1}>{mode === 'login' ? 'Entre na sua área de trabalho.' : 'Crie seu acesso ao laboratório.'}</h2>
          <p className="auth-helper">{mode === 'login' ? 'Use sua conta local para consultar o estado da instalação.' : 'Sua conta dá acesso ao painel desta instalação local.'}</p>

          <div className="auth-tabs" role="group" aria-label="Tipo de acesso">
            <button type="button" aria-pressed={mode === 'login'} onClick={() => changeMode('login')}>Entrar</button>
            <button type="button" aria-pressed={mode === 'register'} onClick={() => changeMode('register')}>Criar conta</button>
          </div>

          <form className="auth-form" aria-label="Formulário de acesso" onSubmit={submit} noValidate>
            <label htmlFor="email">E-mail</label>
            <input id="email" name="email" type="email" autoComplete="email" required value={email} onChange={(event) => { setEmail(event.target.value); setFieldError(null); }} aria-invalid={fieldError?.field === 'email'} aria-describedby={visibleError ? 'auth-error' : undefined} placeholder="voce@exemplo.com" />

            <div className="password-label-row"><label htmlFor="password">Senha</label><span id="password-hint">12 a 128 caracteres</span></div>
            <div className="password-field">
              <input id="password" name="password" type={passwordVisible ? 'text' : 'password'} autoComplete={mode === 'login' ? 'current-password' : 'new-password'} required value={password} onChange={(event) => { setPassword(event.target.value); setFieldError(null); }} aria-invalid={fieldError?.field === 'password'} aria-describedby={`password-hint${visibleError ? ' auth-error' : ''}`} placeholder="Sua senha" />
              <button type="button" className="visibility-button" aria-label="Mostrar senha" aria-pressed={passwordVisible} onClick={() => setPasswordVisible((visible) => !visible)}><Icon name={passwordVisible ? 'eye-off' : 'eye'} /></button>
            </div>

            {visibleError && <p id="auth-error" className="form-error" role="alert">{visibleError}</p>}
            <button className="primary-button" type="submit" disabled={busy}>{busy ? 'Aguarde…' : mode === 'login' ? 'Entrar no laboratório' : 'Criar conta'}<Icon name="arrow" /></button>
          </form>

          <p className="auth-footnote">Use apenas ambientes locais e alvos com autorização explícita.</p>
        </div>
      </section>
    </main>
  );
}

function statusLabel(status: string): string {
  switch (status) {
    case 'available': return 'Implementado';
    case 'planned': return 'Planejado';
    case 'foundation': return 'Fundação';
    default: return 'Estado não reconhecido';
  }
}

function ModuleRow({ module }: { module: DashboardModule }) {
  const statusClass = module.status === 'available' ? 'status-available' : module.status === 'planned' ? 'status-planned' : 'status-unknown';
  return (
    <li className="module-row">
      <div className="module-symbol" aria-hidden="true"><span /></div>
      <div className="module-name"><h3>{module.label}</h3><p>{module.status === 'available' ? 'Incluído no código desta fase' : module.status === 'planned' ? 'Integração prevista para uma próxima fase' : 'Estado informado pela API sem descrição conhecida'}</p></div>
      <span className={`status-pill ${statusClass}`}><span aria-hidden="true" />{statusLabel(module.status)}</span>
    </li>
  );
}

function DashboardView({ user, state, onRetry, onLogout, logoutBusy, logoutError, headingRef }: {
  user: User;
  state: DashboardState;
  onRetry: () => void;
  onLogout: () => void;
  logoutBusy: boolean;
  logoutError: string | null;
  headingRef: RefObject<HTMLHeadingElement | null>;
}) {
  return (
    <div className="dashboard-shell">
      <a className="skip-link" href="#main-content">Ir para o conteúdo</a>
      <aside className="sidebar">
        <Brand />
        <nav aria-label="Navegação principal" className="side-nav">
          <a href="#main-content" aria-current="page"><span className="nav-line" aria-hidden="true" />Visão geral</a>
          <a href="#modules"><span className="nav-line" aria-hidden="true" />Módulos</a>
          <a href="#protocol"><span className="nav-line" aria-hidden="true" />Protocolo</a>
        </nav>
        <div className="sidebar-context"><span className="context-dot" />Instalação local</div>
      </aside>

      <div className="dashboard-main-wrap">
        <header className="topbar">
          <span className="topbar-location"><span className="topbar-app-name">AegisLab <span aria-hidden="true">/</span></span> Visão geral</span>
          <div className="account-actions"><span className="account-email" title={user.email}>{user.email}</span><button type="button" onClick={onLogout} disabled={logoutBusy} aria-label="Sair da conta"><Icon name="logout" /><span>Sair</span></button></div>
        </header>

        <main id="main-content" className="dashboard-content">
          <section className="page-heading" aria-labelledby="page-title">
            <div><p className="section-caption">Área de trabalho</p><h1 id="page-title" ref={headingRef} tabIndex={-1}>Painel de engenharia</h1><p>O estado desta instalação vem da API. Nenhuma medição ou análise é exibida sem execução registrada.</p></div>
            <div className="heading-rule" aria-hidden="true"><span /></div>
          </section>

          {logoutError && <p className="inline-error" role="alert">{logoutError}</p>}

          {state.phase === 'loading' || state.phase === 'idle' ? (
            <div className="loading-panel" role="status">Carregando o estado do laboratório…</div>
          ) : state.phase === 'failed' ? (
            <div className="error-panel" role="alert"><h2>O painel não pôde ser carregado.</h2><p>{state.error}</p><button type="button" onClick={onRetry}><Icon name="refresh" />Tentar novamente</button></div>
          ) : (
            <>
              <section className="foundation-panel" aria-labelledby="foundation-title">
                <div className="foundation-header"><span className="live-indicator" aria-hidden="true" /><span>Estado informado pela API</span></div>
                <div className="foundation-body"><div><p className="foundation-kicker">Instalação atual</p><h2 id="foundation-title">{statusLabel(state.data.status)}</h2></div><p>{state.data.note}</p></div>
              </section>

              <div className="content-grid">
                <section id="modules" className="modules-section" aria-labelledby="modules-title">
                  <div className="section-heading"><div><h2 id="modules-title">Módulos</h2><p>Estado de implementação declarado pela API.</p></div><span className="section-count">{state.data.modules.length} {state.data.modules.length === 1 ? 'módulo' : 'módulos'}</span></div>
                  <ul className="module-list">{state.data.modules.map((module) => <ModuleRow key={module.id} module={module} />)}</ul>
                </section>

                <section id="protocol" className="protocol-panel" aria-labelledby="protocol-title">
                  <div className="protocol-head"><span className="protocol-symbol" aria-hidden="true"><Icon name="check" /></span><h2 id="protocol-title">Antes de executar</h2></div>
                  <p>Todo experimento do AegisLab deve começar com estas decisões registradas.</p>
                  <ol>
                    <li><span>01</span><div><strong>Escopo autorizado</strong><p>Use ambiente local ou alvo aprovado de forma explícita.</p></div></li>
                    <li><span>02</span><div><strong>Limites definidos</strong><p>Fixe duração, concorrência e consumo de recursos.</p></div></li>
                    <li><span>03</span><div><strong>Evidência verificável</strong><p>Documente hipótese, comando, resultado e limitação.</p></div></li>
                  </ol>
                </section>
              </div>
            </>
          )}
          <footer className="dashboard-footer"><span>AegisLab · Fundação</span><span>Dados sintéticos somente em experimentos declarados</span></footer>
        </main>
      </div>
    </div>
  );
}

export function App() {
  const [session, setSession] = useState<SessionState>({ phase: 'checking', user: null });
  const [sessionError, setSessionError] = useState<string | null>(null);
  const [authError, setAuthError] = useState<string | null>(null);
  const [authBusy, setAuthBusy] = useState(false);
  const [dashboard, setDashboard] = useState<DashboardState>({ phase: 'idle', data: null, error: null });
  const [logoutBusy, setLogoutBusy] = useState(false);
  const [logoutError, setLogoutError] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState('');
  const viewHeadingRef = useRef<HTMLHeadingElement>(null);
  // Every session transition starts a new epoch; responses from an older epoch are discarded.
  const sessionEpoch = useRef(0);
  const dashboardRequest = useRef(0);

  function beginSessionEpoch(): number {
    sessionEpoch.current += 1;
    return sessionEpoch.current;
  }

  useEffect(() => {
    const titles: Record<SessionState['phase'], string> = {
      checking: 'Verificando sessão — AegisLab',
      'signed-out': 'Entrar — AegisLab',
      'signed-in': 'Painel — AegisLab',
      failed: 'Erro de sessão — AegisLab',
    };
    document.title = titles[session.phase];
    if (session.phase !== 'checking') viewHeadingRef.current?.focus();
  }, [session.phase]);

  async function loadDashboard() {
    const epoch = sessionEpoch.current;
    const request = ++dashboardRequest.current;
    const isCurrent = () => epoch === sessionEpoch.current && request === dashboardRequest.current;
    setDashboard({ phase: 'loading', data: null, error: null });
    try {
      const data = await getDashboard();
      if (!isCurrent()) return;
      setDashboard({ phase: 'ready', data, error: null });
    } catch (error) {
      if (!isCurrent()) return;
      if (error instanceof ApiError && error.status === 401) {
        beginSessionEpoch();
        setDashboard({ phase: 'idle', data: null, error: null });
        setAuthError('Sua sessão expirou. Entre novamente.');
        setSession({ phase: 'signed-out', user: null });
        return;
      }
      setDashboard({ phase: 'failed', data: null, error: friendlyError(error) });
    }
  }

  async function checkSession() {
    const epoch = beginSessionEpoch();
    setSessionError(null);
    setSession({ phase: 'checking', user: null });
    try {
      const user = await getCurrentUser();
      if (epoch !== sessionEpoch.current) return;
      if (user) {
        setSession({ phase: 'signed-in', user });
        void loadDashboard();
      } else {
        setSession({ phase: 'signed-out', user: null });
      }
    } catch (error) {
      if (epoch !== sessionEpoch.current) return;
      setSession({ phase: 'failed', user: null });
      setSessionError(friendlyError(error));
    }
  }

  useEffect(() => { void checkSession(); }, []);

  async function handleAuthenticate(mode: 'login' | 'register', email: string, password: string) {
    setAuthBusy(true);
    setAuthError(null);
    setAnnouncement('');
    try {
      const user = await authenticate(mode, email, password);
      beginSessionEpoch();
      setSession({ phase: 'signed-in', user });
      void loadDashboard();
    } catch (error) {
      setAuthError(friendlyError(error));
    } finally {
      setAuthBusy(false);
    }
  }

  async function handleLogout() {
    setLogoutBusy(true);
    setLogoutError(null);
    try {
      await logout();
      beginSessionEpoch();
      setDashboard({ phase: 'idle', data: null, error: null });
      setSession({ phase: 'signed-out', user: null });
      setAnnouncement('Sessão encerrada.');
    } catch (error) {
      setLogoutError(friendlyError(error));
    } finally {
      setLogoutBusy(false);
    }
  }

  const view = session.phase === 'checking'
    ? <div className="startup-screen" role="status"><Brand /><p>Verificando sessão…</p></div>
    : session.phase === 'failed'
      ? <div className="startup-screen" role="alert"><Brand /><h1 ref={viewHeadingRef} tabIndex={-1}>Não foi possível verificar a sessão.</h1><p>{sessionError}</p><button type="button" className="primary-button" onClick={() => void checkSession()}>Tentar novamente<Icon name="refresh" /></button></div>
      : session.phase === 'signed-out'
        ? <AuthScreen onAuthenticate={handleAuthenticate} onModeChange={() => setAuthError(null)} busy={authBusy} error={authError} headingRef={viewHeadingRef} />
        : <DashboardView user={session.user} state={dashboard} onRetry={() => void loadDashboard()} onLogout={() => void handleLogout()} logoutBusy={logoutBusy} logoutError={logoutError} headingRef={viewHeadingRef} />;

  return <><div className="sr-only" role="status" aria-live="polite">{announcement}</div>{view}</>;
}
