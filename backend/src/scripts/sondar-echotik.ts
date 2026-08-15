/**
 * Sonda da API do EchoTik — gasta pouco e prova as premissas do plano.
 *
 * Existe porque chave queimada não volta: antes de qualquer coleta de verdade,
 * este script confirma, com o MENOR número possível de requisições, que:
 *
 *  1. a credencial autentica;
 *  2. `page_size` realmente trava em 10 (o plano inteiro depende disso);
 *  3. `video/list` devolve, na mesma linha, o vídeo + `product_id` + `unique_id`
 *     — é essa densidade que faz a coleta por vídeo valer a pena;
 *  4. `min_total_video_cnt` filtra de verdade na origem;
 *  5. o detalhe em lote aceita 10 ids numa chamada só.
 *
 * Não escreve NADA no banco. Só lê, conta e imprime.
 *
 *   npx ts-node src/scripts/sondar-echotik.ts [--teto=12]
 */
import 'dotenv/config';

const BASE = (
  process.env.ECHOTIK_BASE_URL ?? 'https://open.echotik.live/api/v3'
).replace(/\/+$/, '');
const REGION = process.env.ECHOTIK_REGION ?? 'BR';

const AUTH =
  'Basic ' +
  Buffer.from(
    `${process.env.ECHOTIK_APP_ID ?? ''}:${process.env.ECHOTIK_APP_SECRET ?? ''}`,
  ).toString('base64');

/**
 * Teto de requisições da sonda. É uma trava dura, não um alvo: estourou, o
 * script morre. O padrão é baixo de propósito.
 */
const TETO = Number(
  process.argv.find((a) => a.startsWith('--teto='))?.split('=')[1] ?? 12,
);

let gastas = 0;

async function chamar(
  caminho: string,
  params: Record<string, string | number>,
): Promise<{ code?: number; message?: string; data?: unknown } | null> {
  if (gastas >= TETO) {
    throw new Error(`Teto de ${TETO} requisições atingido — sonda encerrada.`);
  }
  const url = new URL(`${BASE}${caminho}`);
  for (const [k, v] of Object.entries(params)) {
    url.searchParams.set(k, String(v));
  }
  gastas += 1;
  const inicio = Date.now();
  const resposta = await fetch(url, {
    headers: { Authorization: AUTH, Accept: 'application/json' },
  });
  const ms = Date.now() - inicio;
  const corpo = (await resposta.json().catch(() => null)) as {
    code?: number;
    message?: string;
    data?: unknown;
  } | null;
  const itens = Array.isArray(corpo?.data)
    ? (corpo?.data as unknown[]).length
    : corpo?.data
      ? 1
      : 0;
  console.log(
    `  [${gastas}/${TETO}] ${caminho} → HTTP ${resposta.status} code=${corpo?.code ?? '?'} itens=${itens} (${ms}ms)` +
      (corpo?.message && corpo.code !== 0 ? ` msg="${corpo.message}"` : ''),
  );
  return corpo;
}

const linhas = (r: { data?: unknown } | null): Array<Record<string, unknown>> =>
  Array.isArray(r?.data) ? (r?.data as Array<Record<string, unknown>>) : [];

async function main(): Promise<void> {
  if (!process.env.ECHOTIK_APP_ID || !process.env.ECHOTIK_APP_SECRET) {
    throw new Error('ECHOTIK_APP_ID/ECHOTIK_APP_SECRET ausentes no .env');
  }
  console.log(`Sonda EchoTik · região ${REGION} · teto ${TETO} requisições\n`);
  const veredito: string[] = [];

  // 1) Autenticação, com a menor página possível.
  console.log('1. Autenticação');
  const auth = await chamar('/echotik/product/list', {
    region: REGION,
    page_num: 1,
    page_size: 1,
  });
  if (auth?.code !== 0) {
    console.error('\n  Credencial recusada. Nada mais será tentado.');
    console.error(`  Resposta: ${JSON.stringify(auth)?.slice(0, 300)}`);
    console.log(`\nRequisições gastas: ${gastas}`);
    process.exit(1);
  }
  veredito.push('autenticação: OK');

  // 2) O teto de página é mesmo 10?
  console.log('\n2. Teto de page_size (o plano inteiro depende disso)');
  const grande = await chamar('/echotik/product/list', {
    region: REGION,
    page_num: 1,
    page_size: 50,
  });
  const devolvidos = linhas(grande).length;
  veredito.push(
    grande?.code === 0
      ? `page_size=50 devolveu ${devolvidos} itens (esperado: 10 ou erro)`
      : `page_size=50 recusado: "${grande?.message}"`,
  );

  // 3) A linha de video/list traz produto e @handle juntos?
  console.log('\n3. Densidade de /echotik/video/list');
  const videos = await chamar('/echotik/video/list', {
    region: REGION,
    sales_flag: 1,
    page_num: 1,
    page_size: 10,
    video_sort_field: 3,
    sort_type: 1,
  });
  const linhasVideo = linhas(videos);
  if (linhasVideo.length) {
    const v = linhasVideo[0];
    const campos = Object.keys(v);
    const temProduto = campos.some((c) => /product/i.test(c));
    const temHandle = 'unique_id' in v;
    console.log(`  campos por linha: ${campos.length}`);
    console.log(`  amostra: ${campos.slice(0, 24).join(', ')}`);
    veredito.push(
      `video/list: ${linhasVideo.length} linhas · product_id ${temProduto ? 'SIM' : 'NÃO'} · unique_id ${temHandle ? 'SIM' : 'NÃO'}`,
    );
  } else {
    veredito.push(`video/list: sem linhas — "${videos?.message ?? 'vazio'}"`);
  }

  // 4) O filtro que resolve o produto sem vídeo funciona?
  console.log('\n4. Filtro min_total_video_cnt');
  const comVideo = await chamar('/echotik/product/list', {
    region: REGION,
    page_num: 1,
    page_size: 10,
    min_total_video_cnt: 1,
    off_mark: 0,
  });
  const produtos = linhas(comVideo);
  const semVideo = produtos.filter(
    (p) => Number(p.total_video_cnt ?? 0) === 0,
  ).length;
  veredito.push(
    produtos.length
      ? `min_total_video_cnt=1 → ${produtos.length} produtos, ${semVideo} sem vídeo (esperado 0)`
      : `min_total_video_cnt=1 → nenhum produto: "${comVideo?.message}"`,
  );

  // 5) Lote de 10 ids numa chamada só.
  console.log('\n5. Detalhe em lote (10 ids)');
  const ids = produtos
    .map((p) => String(p.product_id ?? ''))
    .filter(Boolean)
    .slice(0, 10);
  if (ids.length) {
    const detalhe = await chamar('/echotik/product/detail', {
      product_ids: ids.join(','),
    });
    const d = linhas(detalhe);
    veredito.push(
      `detail com ${ids.length} ids → ${d.length} produtos, ${d[0] ? Object.keys(d[0]).length : 0} campos cada`,
    );
  }

  console.log('\n────────────── veredito ──────────────');
  veredito.forEach((l) => console.log(`· ${l}`));
  console.log(`\nRequisições gastas nesta sonda: ${gastas} de ${TETO}`);
}

main().catch((erro) => {
  console.error(`\nFalhou: ${(erro as Error).message}`);
  console.error(`Requisições gastas até aqui: ${gastas}`);
  process.exit(1);
});
