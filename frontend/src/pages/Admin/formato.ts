/**
 * Formatação do painel administrativo. Datas aparecem de dois jeitos, de
 * propósito: a absoluta (para conferir) e a relativa ("há 3 dias", para
 * bater o olho) — a relativa sozinha esconde o ano, a absoluta sozinha
 * obriga a fazer conta.
 */

export function brl(v: number) {
  return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function parse(iso: string | null | undefined): Date | null {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function data(iso: string | null | undefined) {
  return parse(iso)?.toLocaleDateString('pt-BR') ?? '—';
}

export function dataHora(iso: string | null | undefined) {
  const d = parse(iso);
  return d
    ? d.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
    : '—';
}

/** "agora", "há 12 min", "há 3 h", "há 5 dias", "há 2 meses"... */
export function relativo(iso: string | null | undefined): string {
  const d = parse(iso);
  if (!d) return 'nunca';
  const seg = Math.max(0, Math.round((Date.now() - d.getTime()) / 1000));
  if (seg < 60) return 'agora';
  const min = Math.round(seg / 60);
  if (min < 60) return `há ${min} min`;
  const h = Math.round(min / 60);
  if (h < 24) return `há ${h} h`;
  const dias = Math.round(h / 24);
  if (dias < 30) return `há ${dias} dia${dias === 1 ? '' : 's'}`;
  const meses = Math.round(dias / 30);
  if (meses < 12) return `há ${meses} ${meses === 1 ? 'mês' : 'meses'}`;
  const anos = Math.round(meses / 12);
  return `há ${anos} ano${anos === 1 ? '' : 's'}`;
}

/** Dias inteiros desde a data — para pintar "sumiu" de vermelho. */
export function diasDesde(iso: string | null | undefined): number | null {
  const d = parse(iso);
  return d ? Math.floor((Date.now() - d.getTime()) / 86_400_000) : null;
}

export const PLANO_COR: Record<string, 'default' | 'success' | 'info' | 'warning'> = {
  free: 'warning',
  essencial: 'info',
  pro: 'success',
  business: 'success',
};
