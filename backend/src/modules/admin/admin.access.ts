/**
 * Quem é administrador do PikPok.
 *
 * A lista vive em variável de ambiente (`ADMIN_EMAILS`), e não numa coluna do
 * banco, de propósito: privilégio de administrador é a chave da casa — quem tem
 * enxerga e altera a conta de todo mundo. Guardá-lo em dado significa que
 * qualquer caminho que escreva em `app_users` (um bug num endpoint de perfil,
 * um UPDATE mal filtrado) vira potencial escalada de privilégio. Em ambiente,
 * ele só muda por deploy, por quem tem acesso ao painel de hospedagem.
 *
 * É o mesmo mecanismo de `COMP_ACCOUNT_EMAILS` (billing.config), mas separado
 * de propósito: cortesia é sobre cobrança, administração é sobre poder. Uma
 * conta pode ter uma sem a outra.
 */
export function adminEmails(): string[] {
  return (process.env.ADMIN_EMAILS ?? '')
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}

export function isAdmin(email: string | undefined | null): boolean {
  if (!email) return false;
  return adminEmails().includes(email.trim().toLowerCase());
}
