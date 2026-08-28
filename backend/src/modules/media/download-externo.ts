import * as https from 'node:https';
import type { IncomingHttpHeaders, IncomingMessage } from 'node:http';
import type { LookupAddress } from 'node:dns';
import * as ipaddr from 'ipaddr.js';

/**
 * Buscar, de dentro da nossa rede, uma URL que veio de fora.
 *
 * Isto é um SSRF esperando acontecer, e por isso mora num arquivo só. Duas
 * partes do sistema fazem esse pedido — o proxy de imagem (`/media/proxy`, que
 * é anônimo) e o espelhamento no S3 (que roda com URL vinda do cadastro do
 * cliente e do fornecedor) —, e as duas precisam das MESMAS defesas. Enquanto
 * cada uma tinha o seu `fetch`, só uma delas estava protegida: o proxy foi
 * endurecido numa revisão anterior e o espelhamento seguiu com `redirect:
 * 'follow'`, sem validar host, sem tempo limite e lendo o corpo inteiro com
 * `arrayBuffer()` antes de olhar o tamanho.
 *
 * O que este módulo garante, em qualquer chamador:
 *
 *  1. **Só https, e nunca IP literal.** Endereço numérico não aparece em CDN
 *     legítima e é a forma mais direta de pedir um alvo interno.
 *  2. **O IP resolvido tem que ser público.** A checagem é sobre o ENDEREÇO, e
 *     não sobre o texto do host: qualquer domínio pode ter um registro A
 *     apontando para 127.0.0.1, e comparar strings não vê isso.
 *  3. **Uma resolução só, fixada na conexão.** Ver `resolverHostPublico`.
 *  4. **Redirect seguido à mão**, revalidando cada salto.
 *  5. **Teto de bytes e tempo**, aplicados durante a leitura.
 */

/** Faixas que NÃO são a internet pública. */
function ehEnderecoPublico(endereco: string): boolean {
  let ip: ipaddr.IPv4 | ipaddr.IPv6;
  try {
    ip = ipaddr.parse(endereco);
  } catch {
    return false;
  }
  // 'unicast' é o único intervalo roteável na internet pública. Todo o resto
  // (loopback, private, linkLocal — onde vive o metadata da cloud —,
  // uniqueLocal, carrierGradeNat, reserved) fica de fora.
  if (ip.range() !== 'unicast') return false;
  // IPv4 mapeado em IPv6 (::ffff:127.0.0.1) passa como unicast no IPv6.
  if (ip.kind() === 'ipv6' && (ip as ipaddr.IPv6).isIPv4MappedAddress()) {
    return (ip as ipaddr.IPv6).toIPv4Address().range() === 'unicast';
  }
  return true;
}

/** A origem não atendeu, ou não é um destino que a gente aceita. */
export class OrigemRecusadaError extends Error {}
/** A resposta passou do teto de bytes. */
export class RespostaGrandeDemaisError extends Error {}

/** Aceita só https em host público — nunca IP literal nem outro esquema. */
export function analisarAlvo(bruto: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(bruto);
  } catch {
    throw new OrigemRecusadaError('URL inválida');
  }
  if (parsed.protocol !== 'https:') {
    throw new OrigemRecusadaError('Host não permitido');
  }
  if (ipaddr.isValid(parsed.hostname.replace(/^\[|\]$/g, ''))) {
    throw new OrigemRecusadaError('Host não permitido');
  }
  return parsed;
}

/**
 * Resolve o host, exige que todos os endereços sejam públicos e DEVOLVE o
 * endereço que a conexão deve usar.
 *
 * Devolver o endereço não é conveniência: é o que fecha o buraco.
 *
 * Validar aqui e deixar o cliente HTTP resolver o nome de novo são DUAS
 * resoluções — e entre elas o dono do domínio pode trocar a resposta. É o
 * ataque de DNS rebinding, e ele não é teórico: publica-se um domínio com TTL 0
 * respondendo um IP público na primeira consulta e `169.254.169.254` na
 * segunda. A checagem passa com louvor e a conexão sai para o metadata da
 * cloud — que é onde moram as credenciais da instância.
 *
 * Todos os endereços são exigidos públicos, e não só o escolhido: um host que
 * responde um IP bom e um ruim escolheria sozinho qual usar a cada tentativa.
 */
export async function resolverHostPublico(hostname: string): Promise<string> {
  const { lookup } = await import('node:dns/promises');
  let enderecos: LookupAddress[];
  try {
    enderecos = await lookup(hostname, { all: true });
  } catch {
    throw new OrigemRecusadaError('Host não permitido');
  }
  if (!enderecos.length) throw new OrigemRecusadaError('Host não permitido');
  for (const { address } of enderecos) {
    if (!ehEnderecoPublico(address)) {
      throw new OrigemRecusadaError('Host não permitido');
    }
  }
  return enderecos[0].address;
}

/**
 * GET no endereço JÁ VALIDADO, sem uma segunda resolução de DNS.
 *
 * `fetch` não serve aqui: ele resolve o nome por conta própria e não há como
 * dizer "conecte NESTE IP". O `https.request` aceita um `lookup` próprio, e é
 * por ele que o endereço aprovado é injetado.
 *
 * O `servername` continua sendo o NOME, não o IP: o SNI e a validação do
 * certificado têm que ser feitos contra o domínio pedido — apontar o TLS para o
 * IP faria toda CDN legítima falhar, e desligar a verificação para contornar
 * isso seria abrir outro buraco para fechar este.
 */
function buscarNoIp(
  url: URL,
  ip: string,
  timeoutMs: number,
  cabecalhos: Record<string, string>,
): Promise<{
  status: number;
  headers: IncomingHttpHeaders;
  stream: IncomingMessage;
}> {
  const familia = ipaddr.parse(ip).kind() === 'ipv6' ? 6 : 4;
  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname: url.hostname,
        port: url.port || 443,
        path: `${url.pathname}${url.search}`,
        method: 'GET',
        servername: url.hostname,
        headers: { host: url.host, ...cabecalhos },
        // O Node chama com `all: true` em alguns caminhos e sem ele em outros;
        // os dois formatos de resposta precisam existir.
        lookup: (
          _hostname: string,
          opcoes: { all?: boolean },
          cb: (
            err: NodeJS.ErrnoException | null,
            address: string | LookupAddress[],
            family?: number,
          ) => void,
        ) => {
          if (opcoes?.all) cb(null, [{ address: ip, family: familia }]);
          else cb(null, ip, familia);
        },
        timeout: timeoutMs,
      },
      (res) =>
        resolve({
          status: res.statusCode ?? 0,
          headers: res.headers,
          stream: res,
        }),
    );
    // `timeout` só dispara o evento; sem destruir o socket a requisição fica
    // pendurada para sempre e segura uma conexão do processo.
    req.on('timeout', () => req.destroy(new Error('Tempo esgotado')));
    req.on('error', reject);
    req.end();
  });
}

/** Lê o corpo em pedaços e aborta ao passar do teto. */
async function lerComTeto(
  stream: IncomingMessage,
  maxBytes: number,
): Promise<Buffer> {
  const pedacos: Buffer[] = [];
  let total = 0;
  for await (const pedaco of stream) {
    const buf = pedaco as Buffer;
    total += buf.byteLength;
    if (total > maxBytes) {
      // Destruir, e não só parar de ler: sem isso o upstream continua enviando
      // e a banda que o teto existe para poupar é gasta assim mesmo.
      stream.destroy();
      throw new RespostaGrandeDemaisError('Resposta grande demais');
    }
    pedacos.push(buf);
  }
  return Buffer.concat(pedacos);
}

const UA_PADRAO =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/126.0 Safari/537.36';

export interface OpcoesDeDownload {
  maxBytes: number;
  timeoutMs: number;
  maxRedirects: number;
  /** `accept` e afins. O `user-agent` já vem preenchido. */
  headers?: Record<string, string>;
}

export interface RespostaExterna {
  /** O que o upstream declarou. Pode mentir — quem confirma é quem decodifica. */
  contentType: string;
  buffer: Buffer;
  /** URL depois dos redirects: é dela que sai a extensão, quando precisa. */
  urlFinal: URL;
}

/**
 * Baixa uma URL externa com todas as defesas acima. Lança `OrigemRecusadaError`
 * (destino inválido ou indisponível) ou `RespostaGrandeDemaisError`.
 */
export async function baixarExterno(
  bruto: string,
  opcoes: OpcoesDeDownload,
): Promise<RespostaExterna> {
  let alvo = analisarAlvo(bruto);
  let ip = await resolverHostPublico(alvo.hostname);
  const cabecalhos = { 'user-agent': UA_PADRAO, ...(opcoes.headers ?? {}) };

  let resposta:
    | { status: number; headers: IncomingHttpHeaders; stream: IncomingMessage }
    | undefined;

  // Redirect seguido À MÃO. Deixar o cliente HTTP seguir sozinho faria as
  // checagens valerem só para o primeiro salto — um host público redirecionando
  // para um endereço interno passaria direto. Cada salto é reparseado e
  // resolvido de novo, e é o IP desta resolução que a conexão usa.
  for (let salto = 0; salto <= opcoes.maxRedirects; salto += 1) {
    try {
      resposta = await buscarNoIp(alvo, ip, opcoes.timeoutMs, cabecalhos);
    } catch {
      throw new OrigemRecusadaError('Origem não respondeu');
    }
    const destino = resposta.headers.location;
    if (resposta.status < 300 || resposta.status >= 400 || !destino) break;
    // O corpo do 302 não interessa, mas precisa ser drenado: um socket com
    // dados não lidos não volta para o pool e vaza.
    resposta.stream.resume();
    alvo = analisarAlvo(new URL(destino, alvo).toString());
    ip = await resolverHostPublico(alvo.hostname);
    resposta = undefined;
  }

  if (!resposta || resposta.status < 200 || resposta.status >= 300) {
    resposta?.stream.resume();
    throw new OrigemRecusadaError(
      `Origem respondeu ${resposta?.status ?? 'nada'}`,
    );
  }

  // `content-length` é uma dica do upstream, não garantia — mas quando ela já
  // passa do teto, dá para desistir antes de baixar o primeiro byte.
  const declarado = Number(resposta.headers['content-length'] ?? 0);
  if (declarado > opcoes.maxBytes) {
    resposta.stream.destroy();
    throw new RespostaGrandeDemaisError('Resposta grande demais');
  }

  const tipo = resposta.headers['content-type'];
  return {
    contentType: (Array.isArray(tipo) ? tipo[0] : tipo) ?? '',
    buffer: await lerComTeto(resposta.stream, opcoes.maxBytes),
    urlFinal: alvo,
  };
}

/**
 * Recusa um link que aponta para dentro da rede, sem baixar nada.
 *
 * Existe para o caso em que quem faz o pedido HTTP não é este módulo e sim uma
 * ferramenta externa — hoje o `yt-dlp`, em `POST /cuts/from-url` e
 * `GET /cuts/url-info`. Ali não dá para fixar o IP na conexão (quem conecta é
 * outro processo), então o que sobra é barrar o destino antes de entregar o
 * link para ele.
 *
 * Sem esta checagem, colar `http://169.254.169.254/latest/meta-data/` no campo
 * "importar por link" fazia o servidor buscar o endereço e devolver a diferença
 * entre "não reconheci esse link" e "vídeo indisponível" — que é pouco, e é
 * exatamente o suficiente para varrer a rede interna de fora.
 *
 * Aceita http além de https porque o link é colado por uma pessoa e a
 * plataforma de vídeo redireciona para https de qualquer jeito; o que importa
 * aqui é o destino, não o esquema.
 */
export async function assertDestinoPublico(bruto: string): Promise<URL> {
  let url: URL;
  try {
    url = new URL(bruto);
  } catch {
    throw new OrigemRecusadaError('URL inválida');
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new OrigemRecusadaError('Host não permitido');
  }
  const semColchetes = url.hostname.replace(/^\[|\]$/g, '');
  // IP literal: se já é um endereço, confere direto — não há DNS para resolver.
  if (ipaddr.isValid(semColchetes)) {
    if (!ehEnderecoPublico(semColchetes)) {
      throw new OrigemRecusadaError('Host não permitido');
    }
    return url;
  }
  await resolverHostPublico(url.hostname);
  return url;
}
