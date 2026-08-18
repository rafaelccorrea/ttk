/**
 * Os endereços do site que o desktop abre no navegador.
 *
 * Ficam TODOS aqui porque este app não tem como saber que um link quebrou: ele
 * chama `shell.openExternal` e o erro acontece no navegador do vendedor, numa
 * página que ninguém reporta. E já quebrou de duas formas ao mesmo tempo:
 *
 *  · o domínio `app.pikpok.com.br` NUNCA EXISTIU — o site publicado é
 *    `pikpokviral.com.br`, que é o `APP_URL` do `backend/.env.production`. É o
 *    mesmo erro que o comentário do `API_BASE_PRODUCAO` no `api-client` já
 *    descreve: um domínio bonito que ninguém registrou;
 *  · a rota `/live` também não existia — o roteador do frontend serve
 *    `/copiloto` (ver `frontend/src/routes/index.tsx`).
 *
 * Ao mexer aqui, confira as duas coisas: o domínio contra o `APP_URL` de
 * produção e o caminho contra o roteador do frontend.
 */

/**
 * Em desenvolvimento o site é o Vite local — o mesmo endereço que o
 * `APP_URL` do `backend/.env` usa. Sem isto, testar o botão "comprar horas"
 * jogaria quem desenvolve para dentro do site de produção.
 */
const SITE = import.meta.env.DEV
  ? 'http://localhost:5173'
  : 'https://pikpokviral.com.br';

export const LINKS = {
  /** Onde as bases de conhecimento da live são criadas e marcadas como prontas. */
  copiloto: `${SITE}/copiloto`,
  /** Onde se compra o pacote de horas de live. */
  planos: `${SITE}/planos`,
} as const;
