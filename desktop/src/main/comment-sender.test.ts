import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ConfigDeEnvio,
  EnviadorDeComentarios,
  motivoDeConteudoProibido,
  normalizar,
  prefixarAutor,
  prepararTextoSeguro,
} from './comment-sender';

/**
 * Este é o arquivo com maior potencial de dano do produto: ele digita e envia
 * mensagem em nome do vendedor, na conta dele, ao vivo. Um erro aqui é público,
 * imediato e irreversível — não existe desfazer comentário publicado numa live
 * com mil pessoas assistindo.
 *
 * Por isso os testes daqui cobrem os FREIOS, não o motor. Enviar é a parte
 * fácil; o que precisa de prova é tudo que impede um envio errado.
 */

const CONFIG: ConfigDeEnvio = {
  version: 1,
  killSwitch: false,
  seletores: { campo: ['[data-e2e="comment-text-input"]'], botaoEnviar: [] },
  limites: {
    cooldownMs: 8_000,
    maxPorMinuto: 6,
    maxCaracteres: 140,
    verificacaoMs: 4_000,
  },
};

/**
 * Um enviador com o mundo dublado.
 *
 * `paginaResponde` decide o que a página "devolve": passando `null` (o padrão) a
 * BrowserView não existe e todo envio falha antes de tocar em DOM — é o que se
 * quer quando o teste é sobre a DECISÃO de enviar. Passando um dublê, o caminho
 * completo roda: descobre o campo, digita, confere o eco.
 *
 * A pausa e o kill switch entram por `config`, e não por método, porque é assim
 * que eles chegam de verdade: o backend serve a política e o app obedece.
 */
function montar(
  overrides: Partial<ConfigDeEnvio> = {},
  paginaResponde: ((codigo: string) => unknown) | null = null,
) {
  const confirmarEntrega = vi.fn().mockResolvedValue(undefined);
  const reportarFalhaDeSeletor = vi.fn().mockResolvedValue(undefined);
  const aoCairParaPainel = vi.fn();
  const executeJavaScript = vi.fn(async (codigo: string) =>
    paginaResponde ? paginaResponde(codigo) : null,
  );
  const conteudo = paginaResponde
    ? ({ isDestroyed: () => false, executeJavaScript } as never)
    : null;

  const enviador = new EnviadorDeComentarios({
    webContents: () => conteudo,
    buscarConfig: async () => ({ ...CONFIG, ...overrides }),
    confirmarEntrega,
    reportarFalhaDeSeletor,
    aoCairParaPainel,
  });
  // A política entra agora, sem esperar o timer de 60s — como entraria na
  // abertura da live.
  (enviador as unknown as { config: ConfigDeEnvio }).config = {
    ...CONFIG,
    ...overrides,
  };
  return {
    enviador,
    confirmarEntrega,
    reportarFalhaDeSeletor,
    aoCairParaPainel,
    executeJavaScript,
  };
}

/** Semeia o estado de cadência como se um envio tivesse acabado de acontecer. */
function semearEnvio(
  enviador: EnviadorDeComentarios,
  dados: { texto?: string; authorHash?: string; quando?: number },
) {
  const alvo = enviador as unknown as {
    ultimoEnvioEm: number;
    enviosDaJanela: number[];
    ultimoTextoEnviado: string;
    ultimoEnvioPorAutor: Map<string, number>;
  };
  const quando = dados.quando ?? Date.now();
  alvo.ultimoEnvioEm = quando;
  alvo.enviosDaJanela.push(quando);
  if (dados.texto) alvo.ultimoTextoEnviado = normalizar(dados.texto);
  if (dados.authorHash) alvo.ultimoEnvioPorAutor.set(dados.authorHash, quando);
}

const pedido = (texto: string, authorHash = 'autor-1', replyId = 'r1') => ({
  replyId,
  texto,
  authorHash,
});

describe('o preço que não pode ser publicado errado', () => {
  it('não parte um preço de quatro dígitos no formato que o backend emite', () => {
    // O formato com separador é o que `formatarPreco` produz hoje. Um corte
    // dentro dele publicaria "R$ 1.4" — um valor que a loja não pratica.
    const texto = `${'palavra '.repeat(18)}sai por R$ 1.499,90 no pix`;
    const preparado = prepararTextoSeguro(texto, 140);
    expect(preparado).not.toMatch(/R\$\s*1\.?4\d?(?!99,90)/);
  });

  it('recusa a frase que perdeu o preço no corte, em vez de enviar sem valor', () => {
    // Este é o bug que chegou a existir: a frase ia ao chat como
    // "…sai por apenas R$", prometendo um número que o corte apagou.
    const texto = `${'palavra '.repeat(18)}sai por apenas R$ 1.499,90 hoje`;
    expect(prepararTextoSeguro(texto, 140)).toBe('');
  });

  it('reconhece preço com e sem separador de milhar', () => {
    // Sem separador é o que o backend emitia antes: uma resposta gerada por
    // versão anterior pode estar parada na fila agora.
    for (const escrito of ['R$ 1.499,90', 'R$ 1499,90']) {
      const texto = `${'palavra '.repeat(18)}custa ${escrito} no pix`;
      expect(prepararTextoSeguro(texto, 140)).toBe('');
    }
  });

  it('não mexe no que já cabe', () => {
    expect(prepararTextoSeguro('Sai por R$ 49,90 com frete grátis', 140)).toBe(
      'Sai por R$ 49,90 com frete grátis',
    );
  });

  it('corta sem partir palavra quando não há preço em risco', () => {
    const texto = `${'palavra '.repeat(30)}fim`;
    const preparado = prepararTextoSeguro(texto, 140);
    expect(preparado.length).toBeLessThanOrEqual(140);
    expect(preparado.endsWith('palavr')).toBe(false);
  });
});

describe('conteúdo que nunca vai ao chat', () => {
  it('barra link em qualquer forma', () => {
    for (const t of [
      'olha em https://loja.com',
      'acesse www.loja.com',
      'ta na bio, loja.com.br',
      'link: loja.shop',
    ]) {
      expect(motivoDeConteudoProibido(t)).toMatch(/link/i);
    }
  });

  it('barra menção a perfil', () => {
    expect(motivoDeConteudoProibido('fala com @suporte')).toMatch(/menção/i);
    expect(motivoDeConteudoProibido('@loja responde')).toMatch(/menção/i);
  });

  it('deixa passar resposta legítima que só fala de preço e frete', () => {
    expect(motivoDeConteudoProibido('Sai R$ 49,90 e o frete é grátis!')).toBeNull();
    // E-mail não é link de navegação, mas o padrão de domínio pega — o falso
    // positivo aqui é aceitável: escalar é sempre mais barato que publicar.
    expect(motivoDeConteudoProibido('temos o tamanho M sim')).toBeNull();
  });
});

describe('endereçamento pelo nome, sem menção', () => {
  it('prefixa com o nome de quem perguntou, sem arroba', () => {
    expect(prefixarAutor('sai por R$ 49,90', 'Ana', 150)).toBe('Ana: sai por R$ 49,90');
  });

  it('tira o @ do nome — o arroba é gatilho de anti-spam, não endereço', () => {
    expect(prefixarAutor('temos sim', '@ana.compras', 150)).toBe('ana.compras: temos sim');
  });

  it('sacrifica o prefixo, nunca o corpo, quando estoura o teto', () => {
    const corpo = 'sai por R$ 1.299,00 com frete grátis';
    expect(prefixarAutor(corpo, 'Ana', corpo.length + 3)).toBe(corpo);
  });

  it('sem nome (ou nome absurdo), a resposta sai solta como sempre saiu', () => {
    expect(prefixarAutor('temos sim', undefined, 150)).toBe('temos sim');
    expect(prefixarAutor('temos sim', '   ', 150)).toBe('temos sim');
    expect(prefixarAutor('temos sim', 'x'.repeat(40), 150)).toBe('temos sim');
  });
});

describe('cadência — o que impede o app de parecer um robô', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-17T12:00:00Z'));
  });

  it('bloqueia o segundo envio dentro do cooldown', async () => {
    const { enviador } = montar();
    semearEnvio(enviador, { texto: 'Primeira resposta', authorHash: 'autor-1' });

    vi.setSystemTime(new Date('2026-08-17T12:00:03Z'));
    const segunda = await enviador.enviar(pedido('Segunda resposta', 'autor-2', 'r2'));
    expect(segunda.status).toBe('bloqueada');
    expect(segunda.status === 'bloqueada' && segunda.motivo).toMatch(/intervalo/i);
  });

  it('libera depois de o cooldown passar', async () => {
    const { enviador } = montar();
    semearEnvio(enviador, { texto: 'Primeira', authorHash: 'autor-1' });

    vi.setSystemTime(new Date('2026-08-17T12:00:09Z'));
    const segunda = await enviador.enviar(pedido('Segunda', 'autor-2', 'r2'));
    // Sem página dublada o envio falha na injeção — o que importa é que NÃO foi
    // barrado pela cadência.
    expect(segunda.status).not.toBe('bloqueada');
  });

  it('respeita o teto por minuto', async () => {
    const { enviador } = montar({
      limites: { ...CONFIG.limites, cooldownMs: 0, maxPorMinuto: 3 },
    });
    const base = Date.parse('2026-08-17T12:00:00Z');
    for (let i = 0; i < 3; i += 1) {
      semearEnvio(enviador, { quando: base + i * 1000 });
    }
    vi.setSystemTime(new Date(base + 4000));
    const excedente = await enviador.enviar(pedido('Excedente', 'autor-9', 'r9'));
    expect(excedente.status).toBe('bloqueada');
    expect(excedente.status === 'bloqueada' && excedente.motivo).toMatch(/teto/i);
  });

  it('libera quando a janela de um minuto rola', async () => {
    const { enviador } = montar({
      limites: { ...CONFIG.limites, cooldownMs: 0, maxPorMinuto: 3 },
    });
    const base = Date.parse('2026-08-17T12:00:00Z');
    for (let i = 0; i < 3; i += 1) semearEnvio(enviador, { quando: base + i * 1000 });

    vi.setSystemTime(new Date(base + 61_000));
    const depois = await enviador.enviar(pedido('Agora vai', 'autor-9', 'r9'));
    expect(depois.status).not.toBe('bloqueada');
  });

  it('não responde a mesma pessoa duas vezes em menos de 30 segundos', async () => {
    const { enviador } = montar({ limites: { ...CONFIG.limites, cooldownMs: 0 } });
    semearEnvio(enviador, { authorHash: 'espectador-x' });

    vi.setSystemTime(new Date('2026-08-17T12:00:10Z'));
    const segunda = await enviador.enviar(
      pedido('Sobre o frete', 'espectador-x', 'r2'),
    );
    expect(segunda.status).toBe('bloqueada');
    expect(segunda.status === 'bloqueada' && segunda.motivo).toMatch(/pessoa/i);
  });

  it('não repete o mesmo texto duas vezes seguidas', async () => {
    const { enviador } = montar({ limites: { ...CONFIG.limites, cooldownMs: 0 } });
    semearEnvio(enviador, { texto: 'Sai R$ 49,90' });

    vi.setSystemTime(new Date('2026-08-17T12:01:00Z'));
    const repetida = await enviador.enviar(pedido('Sai R$ 49,90', 'autor-2', 'r2'));
    expect(repetida.status).toBe('bloqueada');
    expect(repetida.status === 'bloqueada' && repetida.motivo).toMatch(/idêntico/i);
  });

  it('conta a tentativa mesmo quando o eco não vem — a mensagem pode ter saído', async () => {
    /*
     * É o viés certo: cooldown a mais custa uma resposta, cooldown a menos custa
     * cadência de bot. Um envio cujo eco falhou ainda arma o freio, senão uma
     * sequência de falhas viraria rajada justamente quando o TikTok está
     * engolindo as mensagens.
     */
    /*
     * A página é dublada pela ORDEM das injeções, que é o contrato real do
     * arquivo: primeiro ele descobre o campo (e espera um seletor de volta),
     * depois digita (e espera { ok }). Casar por conteúdo do script seria
     * frágil — os dois usam querySelector.
     */
    let injecao = 0;
    const { enviador } = montar({}, () => {
      injecao += 1;
      return injecao === 1 ? '[data-e2e="comment-text-input"]' : { ok: true };
    });

    /*
     * A conferência de entrega faz polling até o prazo, então o relógio falso
     * precisa andar junto com a promessa — sem isso o teste espera para sempre
     * por um eco que nunca vai chegar, que é exatamente o cenário sob teste.
     */
    const envio = enviador.enviar(pedido('Sai R$ 49,90', 'autor-1'));
    await vi.advanceTimersByTimeAsync(CONFIG.limites.verificacaoMs + 500);
    const primeira = await envio;

    // Sem eco observado, a entrega não é dada como certa...
    expect(primeira.status).toBe('falhou');
    expect(primeira.status === 'falhou' && primeira.motivo).toMatch(/não apareceu/i);
    // ...mas a cadência foi armada.
    const estado = enviador as unknown as { ultimoEnvioEm: number };
    expect(estado.ultimoEnvioEm).toBeGreaterThan(0);

    const segunda = await enviador.enviar(pedido('Outra coisa', 'autor-2', 'r2'));
    expect(segunda.status).toBe('bloqueada');
  });
});

describe('as travas que desligam o envio', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-17T12:00:00Z'));
  });

  it('não envia com o kill switch ligado', async () => {
    const { enviador } = montar({ killSwitch: true });
    const r = await enviador.enviar(pedido('Qualquer coisa'));
    expect(r.status).toBe('bloqueada');
  });

  it('deixa de estar ativo com o kill switch ligado', () => {
    // `ativo` é o que o Copiloto consulta para decidir se ainda pede envio: um
    // kill switch que só barrasse no `enviar` deixaria a fila girando em falso.
    const { enviador } = montar({ killSwitch: true });
    expect(enviador.ativo).toBe(false);
  });

  it('não envia depois de cair para somente-painel', async () => {
    const { enviador } = montar();
    // A degradação é interna (3 falhas de localização). Aqui simulamos o estado
    // final, que é o que interessa: nesse modo nada mais vai ao chat.
    (enviador as unknown as { somentePainel: boolean }).somentePainel = true;

    const r = await enviador.enviar(pedido('Qualquer coisa'));
    expect(r.status).toBe('bloqueada');
    expect(r.status === 'bloqueada' && r.motivo).toMatch(/painel/i);
    expect(enviador.ativo).toBe(false);
  });

  it('não envia texto vazio nem só espaço', async () => {
    const { enviador } = montar();
    for (const vazio of ['', '   ', '\n\t ']) {
      const r = await enviador.enviar(pedido(vazio));
      expect(r.status).toBe('bloqueada');
    }
  });
});

describe('confirmação de entrega', () => {
  it('só aceita eco do próprio vendedor', () => {
    const { enviador } = montar();
    const espiar = enviador as unknown as { ecos: Array<{ texto: string }> };

    // Espectador repetindo a frase: o público repete preço no chat toda hora, e
    // as nossas respostas são frases sobre preço. Isso NÃO pode confirmar nada.
    enviador.observarMensagem('Sai R$ 49,90 com frete grátis', false);
    expect(espiar.ecos).toHaveLength(0);

    enviador.observarMensagem('Sai R$ 49,90 com frete grátis', true);
    expect(espiar.ecos).toHaveLength(1);
  });

  it('normaliza o texto do eco para casar com o que foi digitado', () => {
    // O webcast devolve com espaçamento e caixa próprios; comparar cru faria
    // toda entrega legítima ser reportada como falha.
    expect(normalizar('  Sai  R$ 49,90  ')).toBe('sai r$ 49,90');
  });
});
