/**
 * Código de indicação (`?ref=`) capturado do link e guardado até o cadastro.
 *
 * Precisa sobreviver à navegação inteira: quem clica no link cai na landing,
 * lê a página, talvez volte depois — e só então cria a conta. Manter o ref na
 * URL até o formulário significaria perdê-lo em qualquer clique interno, que é
 * a indicação do afiliado indo embora sem ninguém perceber.
 *
 * Fica no localStorage (e não em cookie) porque quem lê é o próprio front, no
 * momento de montar o corpo do cadastro. O backend valida o dono do id.
 */
const REF_STORAGE_KEY = 'pikpok.ref';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Lê o `?ref=` da URL atual e guarda. Idempotente: o primeiro link vence. */
export function captureReferral(search: string = window.location.search): void {
  const ref = new URLSearchParams(search).get('ref');
  if (!ref || !UUID_RE.test(ref)) return;
  // O primeiro link não é sobrescrito: quem trouxe a pessoa para o site foi
  // ele, mesmo que ela reentre depois por outro lugar.
  if (localStorage.getItem(REF_STORAGE_KEY)) return;
  localStorage.setItem(REF_STORAGE_KEY, ref);
}

export function getReferral(): string | undefined {
  const ref = localStorage.getItem(REF_STORAGE_KEY);
  return ref && UUID_RE.test(ref) ? ref : undefined;
}

/** Chamado depois do cadastro: o vínculo já está no banco, aqui não serve mais. */
export function clearReferral(): void {
  localStorage.removeItem(REF_STORAGE_KEY);
}
