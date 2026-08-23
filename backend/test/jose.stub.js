/**
 * Dublê do `jose` para o Jest.
 *
 * O `jwks-rsa` (usado no AuthService/guard) importa o `jose`, que só é
 * publicado em ESM — e o Jest deste projeto roda em CommonJS via ts-jest. Sem
 * isto, QUALQUER suíte que toque o AuthService morre em "Unexpected token
 * 'export'" antes de rodar um teste sequer. Nenhum teste exercita JWKS de
 * verdade (os mocks de ConfigService não têm SUPABASE_URL), então um objeto
 * vazio basta.
 */
module.exports = {};
