/**
 * Os endereços do site que o desktop abre no navegador.
 *
 * Ficam TODOS aqui porque este app não tem como saber que um link quebrou: ele
 * chama `shell.openExternal` e o erro acontece no navegador do vendedor, numa
 * página "não encontrado" que ninguém reporta. Já aconteceu uma vez —
 * `/live` foi escrito à mão em duas telas quando a rota real sempre foi
 * `/copiloto`. Com as rotas num arquivo só, conferir contra
 * `frontend/src/routes/index.tsx` é uma leitura, não uma caçada.
 */
const SITE = 'https://app.pikpok.com.br';

export const LINKS = {
  /** Onde as bases de conhecimento da live são criadas e marcadas como prontas. */
  copiloto: `${SITE}/copiloto`,
  /** Onde se compra o pacote de horas de live. */
  planos: `${SITE}/planos`,
} as const;
