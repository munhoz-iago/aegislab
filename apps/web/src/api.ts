export interface User {
  id: string;
  email: string;
  createdAt?: string;
}

export interface DashboardModule {
  id: string;
  label: string;
  status: string;
}

export interface Dashboard {
  status: string;
  modules: DashboardModule[];
  note: string;
}

interface ErrorPayload {
  error?: { code?: string; message?: string };
}

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly retryAfterSeconds?: number,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, {
      ...options,
      credentials: 'include',
      headers: {
        Accept: 'application/json',
        ...(options.body ? { 'Content-Type': 'application/json' } : {}),
        ...options.headers,
      },
    });
  } catch {
    throw new ApiError(0, 'network_error', 'Não foi possível conectar à API. Verifique se o serviço está ativo.');
  }

  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as ErrorPayload;
    const retryAfterHeader = response.headers.get('Retry-After');
    const retryAfter = retryAfterHeader === null ? NaN : Number(retryAfterHeader);
    const retryAfterSeconds = Number.isSafeInteger(retryAfter) && retryAfter > 0 ? retryAfter : undefined;
    throw new ApiError(response.status, body.error?.code ?? 'request_failed', body.error?.message ?? 'A solicitação falhou.', retryAfterSeconds);
  }

  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

export async function getCurrentUser(): Promise<User | null> {
  try {
    const result = await request<{ user: User }>('/api/auth/me');
    return result.user;
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) return null;
    throw error;
  }
}

export async function authenticate(mode: 'login' | 'register', email: string, password: string): Promise<User> {
  const result = await request<{ user: User }>(`/api/auth/${mode}`, {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  });
  return result.user;
}

export function logout(): Promise<void> {
  return request<void>('/api/auth/logout', { method: 'POST' });
}

export function getDashboard(): Promise<Dashboard> {
  return request<Dashboard>('/api/dashboard');
}

export function friendlyError(error: unknown): string {
  if (!(error instanceof ApiError)) return 'Ocorreu uma falha inesperada. Tente novamente.';

  if (error.code === 'database_unavailable') return 'O banco de dados do laboratório está indisponível no momento. Tente novamente em alguns segundos.';
  if ([502, 503, 504].includes(error.status)) return 'A API não está respondendo. Verifique se o serviço está ativo.';
  if (error.code === 'internal_error' || error.status === 500) return 'O servidor encontrou um erro inesperado. Tente novamente em instantes.';
  if (error.code === 'rate_limited' && error.retryAfterSeconds) {
    const minutes = Math.ceil(error.retryAfterSeconds / 60);
    return `Muitas tentativas. Tente novamente em cerca de ${minutes} ${minutes === 1 ? 'minuto' : 'minutos'}.`;
  }

  const messages: Record<string, string> = {
    invalid_credentials: 'E-mail ou senha incorretos.',
    email_in_use: 'Este e-mail já possui uma conta. Entre com sua senha.',
    validation_error: 'Confira o e-mail e use uma senha entre 12 e 128 caracteres.',
    origin_forbidden: 'Este endereço não é aceito pela API. Abra o painel em http://127.0.0.1:5173.',
    rate_limited: 'Muitas tentativas. Aguarde um pouco e tente novamente.',
    unauthorized: 'Sua sessão expirou. Entre novamente.',
    network_error: error.message,
  };

  return messages[error.code] ?? 'Não foi possível concluir a solicitação. Tente novamente.';
}
