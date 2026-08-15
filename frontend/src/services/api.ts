import axios from 'axios';

export const TOKEN_STORAGE_KEY = 'pikpok.accessToken';

/**
 * Base da API.
 *
 * Em dev fica relativa e o Vite faz proxy de /api para o backend
 * (vite.config.ts). Em produção, quando o frontend é servido de um domínio
 * diferente do backend, defina `VITE_API_URL` com a origem completa —
 * ex.: https://api.pikpok.app/api/v1
 */
export const API_BASE_URL = import.meta.env.VITE_API_URL || '/api/v1';

export const api = axios.create({
  baseURL: API_BASE_URL,
});

/**
 * Resolve um caminho de mídia vindo do backend.
 *
 * O banco guarda caminhos RELATIVOS (ex.: /api/v1/media/s3/products/x.webp)
 * para o dado continuar portátil entre ambientes. Aqui eles ganham a origem
 * correta — sem isso, o navegador pediria a imagem ao domínio do frontend e
 * receberia 404 em produção.
 */
export function resolveApiUrl(path: string): string {
  if (/^https?:\/\//.test(path)) return path;
  if (!API_BASE_URL.startsWith('http')) return path;
  // API_BASE_URL termina em /api/v1; o path já começa com /api/v1.
  const origin = new URL(API_BASE_URL).origin;
  return `${origin}${path.startsWith('/') ? '' : '/'}${path}`;
}

api.interceptors.request.use((config) => {
  const token = localStorage.getItem(TOKEN_STORAGE_KEY);
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// Evento global disparado quando algo muda o saldo de créditos (o header escuta).
export const CREDITS_CHANGED_EVENT = 'pikpok:credits-changed';

// Endpoints cujo sucesso altera o saldo (gastos de IA e compras).
const CREDIT_SPENDING = [/^\/studio\/(transcribe|analyze|scripts\/generate)/, /^\/videogen/, /^\/billing\/(packs\/purchase|subscribe)/];

api.interceptors.response.use(
  (response) => {
    const url = response.config.url ?? '';
    const method = (response.config.method ?? '').toLowerCase();
    if (method === 'post' && CREDIT_SPENDING.some((re) => re.test(url))) {
      window.dispatchEvent(new Event(CREDITS_CHANGED_EVENT));
    }
    return response;
  },
  (error) => {
    if (false) {
      localStorage.removeItem(TOKEN_STORAGE_KEY);
      window.location.href = '/login';
    }
    return Promise.reject(error);
  },
);
