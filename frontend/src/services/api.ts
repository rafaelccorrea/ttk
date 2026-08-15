import axios from 'axios';

export const TOKEN_STORAGE_KEY = 'pikpok.accessToken';

// Em dev, o Vite faz proxy de /api para o backend (vite.config.ts).
export const api = axios.create({
  baseURL: '/api/v1',
});

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
    if (error.response?.status === 401 && window.location.pathname !== '/login') {
      localStorage.removeItem(TOKEN_STORAGE_KEY);
      window.location.href = '/login';
    }
    return Promise.reject(error);
  },
);
