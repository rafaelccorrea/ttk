/**
 * O esqueleto do DOM para a telemetria de falha de seletor.
 *
 * ESTE ARQUIVO SÓ EXISTE PARA A REGRA PODER SER TESTADA.
 *
 * A função era o corpo de uma STRING interpolada dentro de `comment-sender.ts`,
 * injetada com `executeJavaScript` na página do TikTok. Enquanto ela vivia como
 * string não havia como exercitá-la: verificar que o nome do espectador não
 * escapa exigiria abrir uma live real. Agora ela é uma função de verdade, o
 * teste a chama com um DOM de mentira, e o `comment-sender` continua injetando
 * exatamente esta implementação — ele serializa a própria função com
 * `toString()`, então não existe uma segunda cópia da lógica para divergir.
 *
 * A LÓGICA NÃO MUDOU UMA LINHA na extração. Duas consequências disso valem ser
 * ditas, porque limitam o que se pode escrever aqui:
 *
 * 1. A função é FECHADA EM SI MESMA. Ela não pode importar nada, não pode
 *    referenciar constante de módulo e não pode usar sintaxe que o bundler
 *    transforme em ajuda externa (helper de `async`, por exemplo): o texto que
 *    sai do `toString()` é tudo que existirá dentro do tiktok.com.
 * 2. O `document` e o `window` chegam por PARÂMETRO, não pelo global, porque no
 *    processo principal do Electron eles não existem — e é essa mesma passagem
 *    por parâmetro que deixa o teste entregar um documento controlado.
 */

/**
 * Reconstrói o HTML da região inferior da página SEM texto e SEM valor de
 * atributo que não esteja na allowlist.
 *
 * NÃO é `outerHTML` filtrado por regex, e a diferença é o ponto do arquivo
 * inteiro: `outerHTML` carrega os ATRIBUTOS, e numa live real são eles que
 * guardam a identidade do espectador — `href="/@fulano"`, `src` do avatar com o
 * id dele, `aria-label`/`title` com o texto do comentário. Apagar só o que está
 * ENTRE as tags deixaria tudo isso viajar pela rede e aparecer em log de proxy.
 *
 * Então o esqueleto é RECONSTRUÍDO nó a nó: nenhum texto atravessa, e de cada
 * elemento só saem os atributos de uma lista fechada — os que descrevem
 * estrutura e servem para escrever um seletor novo —, cada um cortado no
 * comprimento. O servidor sanea de novo (`sanitizarHtml`), porque payload de
 * cliente nunca é confiável, mas o que sai daqui já é o mínimo.
 *
 * @param raiz    O `document.body` da página.
 * @param corte   A altura, em pixels, abaixo da qual o DOM interessa. A região é
 *                a de BAIXO da tela, que é onde a barra de comentário vive:
 *                subir os primeiros 8.000 caracteres do `body` seria subir o
 *                topo do DOM e não incluir justamente o elemento que a
 *                telemetria existe para diagnosticar.
 * @param limite  Teto de caracteres do payload.
 */
export function montarEsqueleto(raiz: Element, corte: number, limite: number): string {
  /*
   * Allowlist de atributos que podem sair COM VALOR.
   *
   * Antes daqui passavam 'id' e qualquer 'data-*', e os dois carregam dado de
   * terceiro no chat do TikTok: 'id' vem como msg-<userId>, e 'data-*' é campo
   * livre da aplicação deles. Nenhum dos dois ajuda a montar seletor — id
   * gerado não se repete entre sessões. Ficam registrados vazios: saber que
   * existem basta, o valor não é nosso.
   *
   * É allowlist e não lista de proibidos porque o HTML é de outra empresa:
   * atributo que eles inventarem amanhã entraria por omissão na regra inversa.
   */
  const comValor = (nome: string): boolean =>
    nome === 'class' ||
    nome === 'role' ||
    nome === 'type' ||
    nome === 'name' ||
    nome === 'contenteditable' ||
    nome === 'disabled' ||
    nome === 'aria-disabled' ||
    nome === 'data-e2e';

  const registravel = (nome: string): boolean =>
    comValor(nome) ||
    nome === 'id' ||
    nome === 'aria-label' ||
    nome.indexOf('data-') === 0 ||
    nome.indexOf('aria-') === 0;

  /*
   * O 'aria-label' é o atributo mais útil da amostra (é rótulo de interface, e
   * a cascata procura por ele) e o mais perigoso: nada impede o TikTok de
   * despejar ali o texto da mensagem.
   *
   * A versão anterior mantinha o valor quando ele CONTIVESSE uma palavra de
   * interface — teste de substring, então "Maria: quero comprar, deixei like"
   * passava inteiro, com nome e recado de espectador. Agora não sai valor
   * nenhum: sai só a palavra-chave que casou, entre colchetes. Para escrever
   * um seletor novo o que importa é o elemento SE ANUNCIAR como campo de
   * comentário, não o que está escrito nele.
   */
  const rotulo =
    /(coment|comment|diga algo|say something|enviar|send|post|buscar|search|curtir|like|compartilhar|share|fechar|close)/i;

  const partes: string[] = [];
  let total = 0;
  const emitir = (t: string): void => {
    if (total < limite) {
      partes.push(t);
      total += t.length;
    }
  };

  const visitar = (el: Element, nivel: number): void => {
    if (total >= limite || nivel > 14) return;
    const tag = (el.tagName || '').toLowerCase();
    if (!tag || tag === 'script' || tag === 'style' || tag === 'svg' || tag === 'noscript') return;

    const r = el.getBoundingClientRect();
    // Elemento que termina acima do corte é outra parte da página. Os de
    // altura zero passam porque costumam ser containers dos que interessam.
    if (r.height > 0 && r.bottom < corte) return;

    let abre = '<' + tag;
    for (const atributo of Array.from(el.attributes || [])) {
      const nome = String(atributo.name || '').toLowerCase();
      if (!registravel(nome)) continue;
      let valor = '';
      if (nome === 'aria-label') {
        const achado = rotulo.exec(String(atributo.value || ''));
        valor = achado ? '[rotulo:' + achado[1].toLowerCase() + ']' : '';
      } else if (comValor(nome)) {
        valor = String(atributo.value || '')
          .replace(/["<>]/g, '')
          .slice(0, 40);
      }
      abre += ' ' + nome + '="' + valor + '"';
    }
    emitir(abre + '>');
    for (const filho of Array.from(el.children)) visitar(filho, nivel + 1);
    emitir('</' + tag + '>');
  };

  visitar(raiz, 0);
  return partes.join('').slice(0, limite);
}
