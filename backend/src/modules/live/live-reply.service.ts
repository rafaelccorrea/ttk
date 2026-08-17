import { HttpException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { createHash } from 'node:crypto';
import { Repository } from 'typeorm';
import { BillingService } from '../billing/billing.service';
import { AiCostService } from '../telemetry/ai-cost.service';
import { AiService, RespostaAoVivo } from '../studio/ai.service';
import { LiveChatMessage } from './entities/live-chat-message.entity';
import { LiveFaq } from './entities/live-faq.entity';
import { LiveProduct } from './entities/live-product.entity';
import { LiveReply, LiveReplyDecision } from './entities/live-reply.entity';
import { LiveRun } from './entities/live-run.entity';
import { LiveSession } from './entities/live-session.entity';

/**
 * Semelhança mínima do pg_trgm para duas mensagens serem a mesma pergunta.
 *
 * O hash exato só pega quem digitou igual, e ninguém digita igual num chat de
 * live: "quanto custa", "qnt custa" e "quanto custaa" são a mesma dúvida com
 * três hashes diferentes. O trigrama cobre a variação de digitação sem custo de
 * modelo. 0.65 é o ponto em que "quanto custa o azul" ainda casa com "quanto
 * custa o azull" e já não casa com "quanto custa o frete" — subir mais funde
 * perguntas diferentes (o erro caro: uma delas fica sem resposta), descer
 * separa a mesma pergunta em vários clusters (o erro barato: paga-se de novo).
 */
const LIMIAR_SIMILARIDADE = 0.65;

/**
 * Quantas irmãs, no máximo, voltam da consulta de cluster.
 *
 * É teto de resultado, não janela: quem delimita o que é "recente" é
 * `JANELA_DO_CLUSTER_MS`. Duzentas irmãs já dizem tudo o que o motor precisa
 * saber (quem é a mais antiga e quantas chegaram nos últimos 30s); trazer mais
 * só engorda o payload.
 */
const MENSAGENS_PARA_COMPARAR = 200;

/**
 * A janela de recência do cluster.
 *
 * Antes isto era "as últimas 200 mensagens da run", numa subconsulta — e essa
 * forma tinha dois defeitos: obrigava a ordenar a run inteira a cada lote e,
 * pior, punha o filtro de semelhança FORA do alcance do índice (o `similarity()`
 * ficava no SELECT externo, e `similarity(a,b) > k` não é indexável de todo
 * jeito — quem usa o GIN é o operador `%`). Com um recorte de tempo o filtro
 * inteiro desce para o WHERE da tabela, onde os índices existem.
 *
 * Trinta minutos é a mesma intenção semântica de antes: uma pergunta feita há
 * duas horas, quando o vendedor mostrava outro produto, não é a mesma pergunta
 * que a de agora, ainda que o texto seja idêntico.
 */
const JANELA_DO_CLUSTER_MS = 30 * 60_000;

/**
 * Por quanto tempo um cluster já respondido silencia as repetições.
 *
 * Depois disso o assunto voltou por conta própria e merece resposta nova — o
 * preço pode ter mudado ao vivo, e responder de novo custa uma linha de lote.
 */
const JANELA_DE_DUPLICADA_MS = 90_000;

/**
 * Quando a repetição deixa de ser ruído e vira sinal.
 *
 * Cinco pessoas perguntando a mesma coisa em trinta segundos não é spam: é o
 * chat inteiro perdido no mesmo ponto, quase sempre porque o vendedor falou o
 * preço antes de metade da audiência entrar. Nesse caso a pergunta sobe ao
 * painel MESMO já respondida — a resposta pronta na tela não resolve, o que
 * resolve é o vendedor dizer aquilo em voz alta de novo.
 */
const ESCALADA_MIN_REPETICOES = 5;
const ESCALADA_JANELA_MS = 30_000;

/**
 * Cortes de confiança. Acima de 0.80 a resposta vai pronta ao painel; entre
 * 0.55 e 0.80 vai marcada para o humano conferir; abaixo disso não aparece —
 * um painel poluído de resposta ruim é pior que um painel com menos linhas,
 * porque o vendedor para de olhar para ele.
 */
const CONFIANCA_ENVIAR = 0.8;
const CONFIANCA_ESCALAR = 0.55;

/**
 * Faixa em que vale pagar o modelo caro de novo.
 *
 * Entre 0.55 e 0.70 o Haiku está em cima do muro, e em pergunta de dinheiro
 * (preço, frete, disponibilidade, tamanho) o muro é caro: é exatamente a
 * pergunta que decide a compra. Reprocessar só essas no Opus custa centavos por
 * live e é o que impede a maioria das escalações inúteis.
 */
const REPROCESSO_MIN = 0.55;
const REPROCESSO_MAX = 0.7;

/** O TikTok aceita 150; 140 deixa margem para o que o painel acrescenta. */
const MAX_CARACTERES = 140;

/**
 * Prefixo mínimo para o cache pegar, em tokens, no Haiku 4.5.
 *
 * O Haiku só cacheia a partir de 4096 tokens de prefixo — o Opus 5 cacheia a
 * partir de 512. Uma live pequena (três produtos, cinco FAQs) fica abaixo disso
 * e o `cache_control` simplesmente não produz entrada nenhuma: sem erro, sem
 * aviso, só `cache_read_input_tokens` zerado para sempre. Não há o que fazer no
 * código além de saber que é assim e não sair caçando bug de cache numa base
 * que nunca teve tamanho para cachear — daí este número existir aqui, com nome,
 * e ser usado só para calibrar o alerta abaixo.
 */
const MIN_TOKENS_DE_CACHE_HAIKU = 4096;

/** Estimativa grosseira de tokens: ~4 caracteres por token em português. */
const CHARS_POR_TOKEN = 4;

/**
 * O intervalo mínimo entre dois débitos da MESMA run.
 *
 * O batimento do desktop é de um minuto, mas quem chama a rota é um cliente que
 * pode reconectar, abrir duas janelas, reagendar o timer sem cancelar o antigo
 * ou simplesmente repetir a chamada em laço. Sem esta janela cada POST vira um
 * minuto real debitado da carteira, e o pacote de horas evapora em segundos.
 * 55s e não 60s porque o batimento chega com jitter de rede: exigir 60 cravados
 * faria o vendedor deixar de pagar um minuto a cada poucos batimentos.
 */
const JANELA_DE_COBRANCA_MS = 55_000;

/**
 * Quanto tempo uma base fica em memória sem ninguém usá-la.
 *
 * `encerrarRun` limpa o caso feliz, mas o caso comum NÃO é feliz: o desktop
 * fecha, trava ou perde a internet, o batimento simplesmente para e nenhum
 * encerramento acontece (ver o comentário do heartbeat em
 * `live-run.controller.ts`). Sem prazo de validade, cada live abandonada deixa o
 * catálogo inteiro serializado retido no processo para sempre.
 */
const TTL_DA_BASE_MS = 30 * 60_000;

/**
 * Por quantos dias o texto do chat dos espectadores fica guardado.
 *
 * O autor já é anônimo por hash, mas o CONTEÚDO é livre e vem de terceiro que
 * nunca foi usuário do PikPok — e ele escreve CPF, telefone e endereço no chat,
 * caso que o próprio código prevê (é a `LISTA_NEGRA`). O que justifica guardar o
 * texto é o dedup, a calibração dos cortes de confiança e a auditoria do que o
 * copiloto respondeu; nada disso precisa de mais de um mês. Passado o prazo, o
 * texto é apagado e a LINHA FICA: os contadores, o cluster e a resposta ligada a
 * ela são registro do serviço prestado ao vendedor, e apagar a mensagem levaria
 * a resposta junto pelo CASCADE.
 */
const DIAS_DE_RETENCAO_DO_CHAT = 30;

/**
 * Palavras que marcam pergunta de alto valor — as que movem venda.
 */
const PALAVRAS_DE_ALTO_VALOR = [
  'quanto',
  'preco',
  'valor',
  'frete',
  'tem em',
  'tamanho',
  'custa',
];

/**
 * Assuntos que NUNCA saem prontos, por mais confiante que o modelo esteja.
 *
 * Reembolso, garantia, nota fiscal, defeito, prazo e dado pessoal são promessa
 * jurídica ou dado de terceiro: a resposta errada aqui não custa uma venda,
 * custa um processo ou um vazamento. Confiança alta do modelo não muda isso —
 * ele pode estar perfeitamente seguro de uma política que a loja não tem.
 */
const LISTA_NEGRA = [
  'reembolso',
  'reembolsar',
  'estorno',
  'garantia',
  'nota fiscal',
  'nf',
  'defeito',
  'quebrado',
  'danificado',
  'prazo',
  'cpf',
  'endereco',
  'telefone',
  'whatsapp',
  'email',
];

/**
 * Palavras que revelam pergunta mesmo sem ponto de interrogação.
 *
 * Quase ninguém digita "?" num chat de live — digita "tem azul", "cabe em mim",
 * "chega quando". Sem esta lista o filtro barato deixaria passar quase tudo
 * para o modelo, que é o custo que a fase inteira existe para evitar.
 */
const PALAVRAS_INTERROGATIVAS = [
  'quanto',
  'qual',
  'quais',
  'quando',
  'como',
  'onde',
  'porque',
  'por que',
  'quem',
  'tem',
  'temos',
  'cabe',
  'serve',
  'chega',
  'entrega',
  'custa',
  'preco',
  'valor',
  'frete',
  'aceita',
  'faz',
  'da pra',
  'da para',
  'pode',
  'vem',
  'dura',
  'ainda',
];

/** Abaixo disto, sem interrogação e sem palavra-chave, é ruído garantido. */
const MIN_CARACTERES_DE_PERGUNTA = 6;

/** Uma mensagem como o app desktop a entrega. */
export interface MensagemDoChat {
  externalMessageId: string;
  authorHash: string;
  text: string;
  receivedAt: Date;
}

/** A base de uma run, montada uma vez e mantida em memória do processo. */
interface BaseEmMemoria {
  serializada: string;
  /** Preço de cada produto, por id — a fonte da verdade do marcador. */
  precos: Map<string, string | null>;
  /** Ids válidos: um id fora daqui numa resposta é alucinação. */
  produtos: Set<string>;
  /** Quantas chamadas já foram feitas nesta run (o alerta de cache olha as primeiras). */
  chamadas: number;
  /** Último uso, em ms — é o que a varredura de ociosas olha para expulsar. */
  usadaEm: number;
}

/* -------------------------------------------------------------------------- *
 *  Funções puras — testadas isoladamente em live-reply.service.spec.ts        *
 * -------------------------------------------------------------------------- */

/**
 * Reduz a mensagem ao que ela realmente pergunta.
 *
 * Minúsculas, sem acento, sem emoji, sem pontuação, espaços colapsados. É o
 * texto sobre o qual tudo o mais decide: sem isto, "QUANTO CUSTA??? 😍" e
 * "quanto custa" seriam duas perguntas distintas e seriam pagas duas vezes.
 */
export function normalizarTexto(texto: string): string {
  return (texto ?? '')
    .toLowerCase()
    // NFD separa o acento da letra; o intervalo seguinte remove o acento e
    // deixa a letra — é o que faz "preço" e "preco" virarem a mesma chave.
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    /*
     * Tudo que não é letra ASCII, dígito ou espaço vira espaço. É um filtro só,
     * e de propósito: ele resolve pontuação e emoji na mesma passada — emoji
     * está inteiro fora do intervalo a-z0-9 —, sem depender de listar faixas
     * Unicode que envelhecem a cada versão do padrão.
     */
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * A chave do casamento EXATO. O trigrama cobre o resto, mas ele custa uma
 * consulta por mensagem; o hash resolve de graça o caso mais comum de todos —
 * meia dúzia de pessoas mandando literalmente "preço" ao mesmo tempo.
 */
export function clusterKeyDe(textoNormalizado: string): string {
  return createHash('sha1').update(textoNormalizado).digest('hex');
}

/**
 * Decide, sem gastar token, se a mensagem é pergunta.
 *
 * A maior parte de um chat de live é "kkkk", "top", coração e nome de cidade.
 * Mandar isso ao modelo é pagar por lote inteiro de nada, e a resposta que o
 * modelo inventa para "kkkk" ainda entope o painel. O critério é deliberadamente
 * generoso — interrogação OU palavra interrogativa OU tamanho suficiente —
 * porque deixar passar ruído custa fração de centavo e barrar uma pergunta de
 * verdade custa a venda.
 */
export function ehPergunta(texto: string): boolean {
  if (texto?.includes('?')) return true;
  const normalizado = normalizarTexto(texto);
  if (!normalizado) return false;
  if (PALAVRAS_INTERROGATIVAS.some((p) => normalizado.includes(p))) return true;
  return normalizado.length >= MIN_CARACTERES_DE_PERGUNTA * 3;
}

/** A pergunta é das que decidem a compra e merecem o modelo caro na dúvida? */
export function ehAltoValor(textoNormalizado: string): boolean {
  return PALAVRAS_DE_ALTO_VALOR.some((p) => textoNormalizado.includes(p));
}

/** A pergunta toca assunto que sempre vai ao humano? */
export function ehListaNegra(textoNormalizado: string): boolean {
  return LISTA_NEGRA.some((p) =>
    new RegExp(`(^|\\s)${p}(\\s|$)`).test(textoNormalizado),
  );
}

/**
 * O veredito sobre uma resposta gerada.
 *
 * A ÂNCORA EM FONTE é a regra que importa: confiança alta com `productIds`
 * vazio vira escalação, sempre. Um modelo confiante e sem fonte é exatamente o
 * retrato da alucinação de preço, e nenhuma instrução de prompt segura isso tão
 * bem quanto recusar a resposta que não consegue apontar de onde veio.
 */
export function decidirResposta(entrada: {
  confianca: number;
  sourceProductIds: string[];
  perguntaNormalizada: string;
}): LiveReplyDecision {
  const { confianca, sourceProductIds, perguntaNormalizada } = entrada;
  if (confianca < CONFIANCA_ESCALAR) return 'silenciar';
  if (ehListaNegra(perguntaNormalizada)) return 'escalar';
  if (confianca >= CONFIANCA_ENVIAR && sourceProductIds.length > 0) {
    return 'enviar';
  }
  return 'escalar';
}

/** Reais como o chat lê: "49,90". */
function formatarPreco(valor: string): string {
  const numero = Number(valor);
  if (!Number.isFinite(numero)) return valor;
  return numero.toFixed(2).replace('.', ',');
}

/**
 * Troca os marcadores {{PRECO:id}} pelo preço do banco.
 *
 * O modelo NUNCA escreve preço, e esta é a regra dura do produto. Um número que
 * o modelo digitou tem chance de estar certo; um número que veio da coluna
 * `priceBrl` está certo por construção. E preço errado numa live não é um erro
 * de resposta: é uma venda fechada por um valor que a loja não pratica, com o
 * cliente tendo print da tela.
 *
 * `resolvido` fica falso quando sobra marcador — id que não existe na base, ou
 * produto sem preço cadastrado. Quem chama transforma isso em escalação: melhor
 * a pergunta ir ao humano do que a resposta sair com "{{PRECO:...}}" no meio ou,
 * pior, com o marcador removido e a frase afirmando um preço que sumiu.
 */
export function aplicarPrecos(
  texto: string,
  precos: Map<string, string | null>,
): { texto: string; resolvido: boolean } {
  let resolvido = true;
  const saida = (texto ?? '').replace(
    /\{\{\s*PRECO\s*:\s*([^}]+?)\s*\}\}/g,
    (marcador, id: string) => {
      const preco = precos.get(id.trim());
      if (preco === undefined || preco === null) {
        resolvido = false;
        return marcador;
      }
      return `R$ ${formatarPreco(preco)}`;
    },
  );
  /*
   * O regex acima só enxerga o marcador BEM FORMADO. O modelo, porém, erra a
   * forma antes de errar o id: escreve `{{PRECO:abc}` com uma chave só, `{{PREÇO:
   * abc}}` com cedilha, `{{ PRECO abc }}` sem os dois pontos. Nada disso casa, a
   * substituição não acontece e — sem esta varredura — `resolvido` continuaria
   * verdadeiro, mandando ao painel uma resposta com lixo de template na cara do
   * vendedor ou, pior, sem preço nenhum onde deveria haver um.
   *
   * Qualquer chave sobrando, ou um `PRECO:` em caixa alta solto, é por definição
   * marcador que não virou preço. O teste é sensível à caixa de propósito: a
   * resposta legítima diz "o preço é R$ 49,90" depois da substituição, e barrar
   * a palavra "preço" escalaria toda resposta de preço que deu certo.
   */
  if (/\{\{|\}\}|PRE[CÇ]O\s*:/.test(saida)) resolvido = false;
  return { texto: saida, resolvido };
}

/**
 * A resposta escreveu um preço em número, por conta própria?
 *
 * A regra dura do produto é "o modelo NUNCA escreve preço" — ele escreve o
 * marcador e o banco preenche. Até aqui essa regra só existia como instrução no
 * prompt, e instrução de prompt não é garantia: basta o Haiku responder "sai por
 * R$ 39,90 hoje!" com um productId válido e confiança 0.9 para o painel entregar
 * um preço alucinado como se tivesse vindo da coluna `priceBrl`, sem marcador
 * sobrando, sem log e sem escalação.
 *
 * Roda sobre o texto CRU do modelo, antes da substituição: depois dela o "R$"
 * legítimo que o banco escreveu estaria lá e o teste acusaria todo mundo.
 */
export function contemPrecoLiteral(texto: string): boolean {
  return /(r\$|\breais\b|\bconto\b)|\d+[.,]\d{2}(?!\d)/i.test(texto ?? '');
}

/** Link ou @menção numa resposta de live é vetor de golpe — não sai daqui. */
export function contemLinkOuMencao(texto: string): boolean {
  return /(https?:\/\/|www\.|\S+\.(com|br|net|shop|store)\b|@\w)/i.test(
    texto ?? '',
  );
}

/** Corta na palavra, para a resposta não terminar no meio de uma. */
export function truncar(texto: string, max = MAX_CARACTERES): string {
  const limpo = (texto ?? '').replace(/\s+/g, ' ').trim();
  if (limpo.length <= max) return limpo;
  const cortado = limpo.slice(0, max);
  const espaco = cortado.lastIndexOf(' ');
  return (espaco > max * 0.6 ? cortado.slice(0, espaco) : cortado).trim();
}

/* -------------------------------------------------------------------------- *
 *  O motor                                                                    *
 * -------------------------------------------------------------------------- */

@Injectable()
export class LiveReplyService {
  private readonly logger = new Logger(LiveReplyService.name);

  /**
   * A base de cada run aberta NESTE processo.
   *
   * Não há vector DB, e é escolha: uma live tem de 5 a 50 produtos e de 20 a
   * 200 FAQs, o que cabe inteiro no prompt. Recuperar por embedding traria a
   * latência de um índice externo, um segundo lugar para a base ficar
   * desatualizada, e — o que decide — um prefixo diferente a cada lote, que é
   * exatamente o que destrói o cache. Base inteira, sempre igual, byte a byte:
   * é isso que faz o custo por minuto fechar.
   *
   * Em memória do processo, sem Redis, com a consequência assumida: um restart
   * perde as bases e a próxima chamada remonta a partir do banco. O que se
   * perde é o cache quente da Anthropic, não dado.
   */
  private readonly bases = new Map<string, BaseEmMemoria>();

  constructor(
    @InjectRepository(LiveRun)
    private readonly runs: Repository<LiveRun>,
    @InjectRepository(LiveChatMessage)
    private readonly mensagens: Repository<LiveChatMessage>,
    @InjectRepository(LiveReply)
    private readonly respostas: Repository<LiveReply>,
    @InjectRepository(LiveProduct)
    private readonly produtos: Repository<LiveProduct>,
    @InjectRepository(LiveFaq)
    private readonly faq: Repository<LiveFaq>,
    @InjectRepository(LiveSession)
    private readonly sessoes: Repository<LiveSession>,
    private readonly ai: AiService,
    private readonly billing: BillingService,
    private readonly custos: AiCostService,
  ) {}

  // ------------------------------------------------------------------- runs
  /**
   * Abre a transmissão.
   *
   * A cortesia é concedida AQUI, e não na primeira cobrança: `grantLiveTrial` é
   * idempotente, mas se ela só rodasse no primeiro `cobrarMinuto`, o vendedor
   * estreante veria um 402 antes de a cortesia entrar no saldo — a conta certa
   * pela ordem errada. Conceder ao abrir garante que o primeiro débito encontra
   * saldo.
   */
  async abrirRun(
    userId: string,
    dados: {
      knowledgeSessionId: string;
      tiktokRoomId?: string | null;
      tiktokUsername?: string | null;
    },
  ): Promise<LiveRun> {
    /*
     * A base é conferida ANTES da cortesia e da run: abrir sobre uma sessão de
     * outro dono seria vazamento de catálogo, e abrir sobre uma que ainda está
     * transcrevendo daria uma live inteira respondendo do vazio — com minutos
     * sendo debitados a cada batimento por respostas que ninguém pode usar.
     */
    const base = await this.sessoes.findOneBy({
      id: dados.knowledgeSessionId,
      userId,
    });
    if (!base) {
      throw new NotFoundException('Base de conhecimento não encontrada.');
    }
    if (base.status !== 'pronta') {
      throw new HttpException(
        'A base de conhecimento desta live ainda não está pronta. Espere a extração terminar antes de entrar ao vivo.',
        409,
      );
    }

    await this.billing.grantLiveTrial(userId);

    const run = await this.runs.save(
      this.runs.create({
        userId,
        knowledgeSessionId: dados.knowledgeSessionId,
        tiktokRoomId: dados.tiktokRoomId ?? null,
        tiktokUsername: dados.tiktokUsername ?? null,
        status: 'conectando',
        mode: 'painel',
        startedAt: new Date(),
      }),
    );

    // Monta a base já na abertura: o primeiro lote chega em ~800ms e não pode
    // pagar a leitura do catálogo inteiro na frente da primeira resposta.
    await this.baseDaRun(run);
    return run;
  }

  async encerrarRun(
    userId: string,
    runId: string,
    motivo?: string,
  ): Promise<LiveRun> {
    const run = await this.acharRun(userId, runId);
    run.status = motivo ? 'erro' : 'encerrada';
    run.endedAt = new Date();
    if (motivo) run.errorMessage = motivo.slice(0, 500);
    this.bases.delete(run.id);
    return this.runs.save(run);
  }

  /** A run do usuário, com os contadores atualizados. */
  async obterRun(userId: string, runId: string): Promise<LiveRun> {
    return this.acharRun(userId, runId);
  }

  /**
   * Carimba que o vendedor copiou a resposta do painel.
   *
   * Só o primeiro clique conta: o carimbo responde "esta resposta serviu?", e
   * copiar duas vezes não a torna duas vezes melhor — reescrever o horário a
   * cada clique só embaralharia a distância entre gerar e usar, que é o que
   * calibra os cortes de confiança depois.
   */
  async marcarCopiada(userId: string, replyId: string): Promise<LiveReply> {
    const resposta = await this.respostas.findOneBy({ id: replyId, userId });
    if (!resposta) throw new NotFoundException('Resposta não encontrada.');
    if (resposta.copiedAt) return resposta;
    resposta.copiedAt = new Date();
    return this.respostas.save(resposta);
  }

  // ------------------------------------------------------------------ lote
  /**
   * O ciclo completo de um lote do chat.
   *
   * O desktop agrupa ~800ms de chat e manda de uma vez. Tudo o que dá para
   * decidir sem modelo é decidido antes dele — não é pergunta, é duplicada,
   * já foi respondida — e só o que sobra vira uma única chamada.
   */
  async processarLote(
    runId: string,
    userId: string,
    lote: MensagemDoChat[],
  ): Promise<{ respostas: LiveReply[]; escaladas: LiveChatMessage[] }> {
    const run = await this.acharRun(userId, runId);
    if (run.status === 'encerrada' || run.status === 'erro') {
      throw new HttpException('Esta transmissão já foi encerrada.', 409);
    }
    if (!lote.length) return { respostas: [], escaladas: [] };

    const comecou = Date.now();
    const base = await this.baseDaRun(run);

    const gravadas: LiveChatMessage[] = [];
    /*
     * Map, e não array: num lote de cinco duplicatas da mesma pergunta com o
     * cluster já velho, o laço abaixo empurraria CINCO VEZES a mesma mensagem
     * original — a mesma pergunta iria cinco vezes no prompt, viraria cinco
     * linhas idênticas em `live_replies`, contaria cinco em `repliesGenerated` e
     * o painel mostraria a mesma resposta cinco vezes. A chave é o id da
     * mensagem, então a segunda ocorrência é um no-op por construção.
     */
    const paraResponder = new Map<string, LiveChatMessage>();
    const escaladas: LiveChatMessage[] = [];

    for (const entrada of lote) {
      const normalizado = normalizarTexto(entrada.text);
      const pergunta = ehPergunta(entrada.text);
      const clusterKey = normalizado ? clusterKeyDe(normalizado) : null;

      const mensagem = await this.gravarMensagem(run, entrada, {
        normalizado,
        pergunta,
        clusterKey,
      });
      // Colisão da chave de idempotência: o app reenviou o que já entrou.
      if (!mensagem) continue;
      gravadas.push(mensagem);

      if (!pergunta) {
        mensagem.status = 'ignorada';
        await this.mensagens.save(mensagem);
        continue;
      }

      const irmas = await this.irmasDoCluster(run.id, mensagem, normalizado);
      if (irmas.length) {
        /*
         * O cluster já existe. A mensagem herda a chave da irmã mais antiga —
         * é ela quem carrega o `repeatCount`, e é por ela que a resposta já
         * dada é encontrada.
         */
        const original = irmas[irmas.length - 1];
        mensagem.clusterKey = original.clusterKey ?? clusterKey;
        mensagem.status = 'duplicada';
        await this.mensagens.save(mensagem);
        await this.mensagens.increment(
          { id: original.id },
          'repeatCount',
          1,
        );
        original.repeatCount += 1;

        const respondidoRecente = await this.respondidoRecentemente(
          run.id,
          irmas.map((m) => m.id),
        );
        const pressao = irmas.filter(
          (m) =>
            comecou - new Date(m.receivedAt).getTime() <= ESCALADA_JANELA_MS,
        ).length;

        if (respondidoRecente && pressao + 1 < ESCALADA_MIN_REPETICOES) {
          continue;
        }
        if (respondidoRecente) {
          /*
           * Já respondido, mas o chat inteiro está perguntando de novo dentro
           * de trinta segundos. Não adianta gerar outra resposta: a resposta já
           * está na tela e não resolveu. O que sobe é a própria pergunta,
           * marcada, para o vendedor FALAR aquilo em voz alta.
           */
          original.status = 'escalada';
          await this.mensagens.save(original);
          escaladas.push(original);
          continue;
        }
        // Cluster antigo o suficiente: responde de novo, com o peso da fila.
        paraResponder.set(original.id, original);
        continue;
      }

      paraResponder.set(mensagem.id, mensagem);
    }

    await this.runs.increment(
      { id: run.id },
      'messagesSeen',
      gravadas.length,
    );

    if (!paraResponder.size) {
      if (escaladas.length) {
        await this.runs.increment({ id: run.id }, 'escalations', escaladas.length);
      }
      return { respostas: [], escaladas };
    }

    const geradas = await this.gerarRespostas(
      run,
      base,
      [...paraResponder.values()],
      comecou,
    );
    return { respostas: geradas.respostas, escaladas: [...escaladas, ...geradas.escaladas] };
  }

  /**
   * Uma chamada ao Haiku para o lote inteiro, e — só quando preciso — uma
   * segunda ao Opus para as perguntas caras que ficaram em cima do muro.
   */
  private async gerarRespostas(
    run: LiveRun,
    base: BaseEmMemoria,
    mensagens: LiveChatMessage[],
    comecou: number,
  ): Promise<{ respostas: LiveReply[]; escaladas: LiveChatMessage[] }> {
    const perguntas = mensagens.map((m) => ({
      messageId: m.id,
      texto: m.text,
      repeticoes: m.repeatCount,
    }));

    const lote = await this.ai.responderChatDaLive({
      baseSerializada: base.serializada,
      perguntas,
      modelo: 'claude-haiku-4-5',
      userId: run.userId,
    });
    base.chamadas += 1;
    this.conferirCache(run, base, lote.cacheReadTokens);

    const porId = new Map(lote.respostas.map((r) => [r.messageId, r]));

    /*
     * O reprocesso acontece ANTES de qualquer decisão ser tomada: decidir com o
     * número do Haiku e depois "melhorar" seria decidir duas vezes, e a primeira
     * decisão já teria virado escalação no painel.
     */
    const reprocessar = mensagens.filter((m) => {
      const r = porId.get(m.id);
      if (!r) return false;
      const confianca = Number(r.confidence);
      return (
        confianca >= REPROCESSO_MIN &&
        confianca < REPROCESSO_MAX &&
        ehAltoValor(normalizarTexto(m.text))
      );
    });

    if (reprocessar.length) {
      const segundo = await this.ai.responderChatDaLive({
        baseSerializada: base.serializada,
        perguntas: reprocessar.map((m) => ({
          messageId: m.id,
          texto: m.text,
          repeticoes: m.repeatCount,
        })),
        modelo: 'claude-opus-5',
        userId: run.userId,
      });
      base.chamadas += 1;
      for (const r of segundo.respostas) porId.set(r.messageId, r);
      this.logger.log(
        `Run ${run.id}: ${reprocessar.length} pergunta(s) de alto valor reprocessada(s) no Opus.`,
      );
    }

    const modeloDe = (id: string) =>
      reprocessar.some((m) => m.id === id) ? 'claude-opus-5' : lote.model;

    const respostas: LiveReply[] = [];
    const escaladas: LiveChatMessage[] = [];

    for (const mensagem of mensagens) {
      const bruta = porId.get(mensagem.id);
      if (!bruta) {
        // O modelo não respondeu esta: o painel não pode simplesmente engolir a
        // pergunta, então ela vai ao humano.
        mensagem.status = 'escalada';
        await this.mensagens.save(mensagem);
        escaladas.push(mensagem);
        continue;
      }

      const resposta = await this.materializar(
        run,
        base,
        mensagem,
        bruta,
        modeloDe(mensagem.id),
        comecou,
      );
      respostas.push(resposta);
      if (resposta.decision === 'escalar') escaladas.push(mensagem);
    }

    await this.runs.increment({ id: run.id }, 'repliesGenerated', respostas.length);
    if (escaladas.length) {
      await this.runs.increment({ id: run.id }, 'escalations', escaladas.length);
    }
    return { respostas, escaladas };
  }

  /** Aplica preço, limpa, decide e grava. */
  private async materializar(
    run: LiveRun,
    base: BaseEmMemoria,
    mensagem: LiveChatMessage,
    bruta: RespostaAoVivo,
    model: string,
    comecou: number,
  ): Promise<LiveReply> {
    const normalizado = normalizarTexto(mensagem.text);
    // Só ids que existem na base contam como fonte: um id inventado é o
    // contrário de uma âncora, e passaria a alucinação como se fosse prova.
    const fontes = (bruta.productIds ?? []).filter((id) =>
      base.produtos.has(id),
    );
    const preco = aplicarPrecos(bruta.text ?? '', base.precos);
    const texto = truncar(preco.texto);

    let confianca = Number(bruta.confidence);
    if (!Number.isFinite(confianca)) confianca = 0;
    confianca = Math.min(Math.max(confianca, 0), 1);

    let decisao = decidirResposta({
      confianca,
      sourceProductIds: fontes,
      perguntaNormalizada: normalizado,
    });

    // Marcador sobrando quer dizer preço que a base não confirma. Vai ao humano
    // em vez de sair com um id cru — ou, pior, com a frase afirmando um preço
    // que a substituição não conseguiu escrever.
    if (!preco.resolvido) decisao = 'escalar';
    /*
     * O contrário do marcador sobrando: o modelo IGNOROU o marcador e digitou o
     * número. Sem esta checagem a resposta passa limpa por tudo — não há
     * marcador para sobrar, `resolvido` é verdadeiro e um preço alucinado chega
     * ao painel com a mesma cara de um preço vindo do banco. O log é parte da
     * correção: é o sinal de que o prompt (ou o modelo) regrediu.
     */
    if (contemPrecoLiteral(bruta.text ?? '')) {
      decisao = 'escalar';
      this.logger.warn(
        `Run ${run.id}: o modelo escreveu preço direto no texto em vez de usar {{PRECO:id}} — resposta escalada. Conferir a instrução do prompt.`,
      );
    }
    // Link ou @menção: nunca vai pronto ao painel, mesmo confiante.
    if (contemLinkOuMencao(texto)) decisao = 'escalar';
    if (!texto) decisao = 'silenciar';

    mensagem.status = decisao === 'enviar' ? 'respondida' : 'escalada';
    if (decisao === 'silenciar') mensagem.status = 'ignorada';
    await this.mensagens.save(mensagem);

    try {
      return await this.respostas.save(
        this.respostas.create({
          liveRunId: run.id,
          chatMessageId: mensagem.id,
          userId: run.userId,
          text: texto,
          confidence: confianca.toFixed(2),
          model,
          decision: decisao,
          sourceProductIds: fontes,
          latencyMs: Date.now() - comecou,
        }),
      );
    } catch (error) {
      /*
       * Uma mensagem, uma resposta — garantido pelo banco.
       *
       * O dedup do lote e a janela de 90s resolvem o caso comum, mas os dois
       * vivem na memória de UM processo, e `processarLote` roda fora da
       * requisição: dois lotes em voo ao mesmo tempo passam juntos pela
       * checagem e materializam duas respostas para a mesma mensagem — duas
       * linhas no painel e duas linhas de custo. A restrição única é a única
       * trava que vale sob concorrência e sobrevive a mais de uma instância.
       *
       * Perder a corrida não é erro: alguém já respondeu esta mensagem, e é
       * essa resposta que vale. Devolvemos a que ficou de pé.
       */
      const existente = await this.respostas.findOneBy({
        chatMessageId: mensagem.id,
      });
      if (existente) {
        this.logger.warn(
          `Resposta concorrente para a mensagem ${mensagem.id}: a primeira prevaleceu.`,
        );
        return existente;
      }
      throw error;
    }
  }

  // --------------------------------------------------------------- cobrança
  /**
   * Debita um minuto de transmissão.
   *
   * Um minuto por chamada, e não um bloco pelo tempo total, porque a run pode
   * cair a qualquer segundo: cobrando de minuto em minuto, o pior caso é o
   * vendedor pagar o minuto que estava correndo.
   *
   * QUEM IMPEDE A DOBRA É `lastChargedAt`, E É PRECISO LÊ-LO — guardá-lo não
   * basta. Quem chama esta rota é um cliente: ele reconecta e reagenda o
   * batimento sem cancelar o antigo, o vendedor abre duas janelas, um cliente
   * adulterado chama em laço. Cada chamada que passasse debitaria um minuto real
   * da carteira, e o pacote de horas iria a zero em segundos.
   *
   * A reserva do minuto é um UPDATE CONDICIONAL, e não uma leitura seguida de
   * escrita: dois batimentos simultâneos leriam o mesmo `lastChargedAt` velho e
   * ambos concluiriam que podem cobrar. Com a condição dentro do próprio UPDATE,
   * o Postgres decide — exatamente uma das linhas volta com `affected = 1`. Só
   * ela chama o billing; se o billing falhar, a reserva é desfeita.
   *
   * Sem saldo, o billing lança 402 e a run é ENCERRADA aqui mesmo, com motivo
   * legível: seguir respondendo de graça é o modo mais caro de descobrir que
   * alguém acabou o pacote.
   */
  async cobrarMinuto(runId: string): Promise<LiveRun> {
    const run = await this.runs.findOneBy({ id: runId });
    if (!run) throw new NotFoundException('Transmissão não encontrada.');
    if (run.status === 'encerrada' || run.status === 'erro') return run;

    const carimboAnterior = run.lastChargedAt;
    const limite = new Date(Date.now() - JANELA_DE_COBRANCA_MS);
    const reserva = await this.runs
      .createQueryBuilder()
      .update(LiveRun)
      .set({
        minutesCharged: () => '"minutesCharged" + 1',
        lastChargedAt: () => 'now()',
      })
      .where('id = :id', { id: runId })
      .andWhere('("lastChargedAt" IS NULL OR "lastChargedAt" <= :limite)', {
        limite,
      })
      .execute();

    if (!reserva.affected) {
      // Batimento repetido dentro do mesmo minuto: nada a cobrar. Devolve o
      // estado atual para o painel seguir mostrando os contadores certos.
      return run;
    }

    try {
      await this.billing.chargeLiveMinutes(run.userId, 1);
      /*
       * A receita do copiloto ao vivo entra no relatório de margem AQUI, e não
       * na chamada do modelo, porque custo e receita acontecem em momentos
       * diferentes: o custo nasce a cada resposta gerada, a receita nasce no
       * relógio. Registrar um evento de custo zero com o minuto cobrado é o que
       * fecha a conta — sem ele, `live_reply` apareceria com todo o custo e
       * receita nenhuma, e o relatório leria como prejuízo permanente um
       * recurso que está pago.
       */
      void this.custos.registrar(
        'live_reply',
        'cobranca',
        {},
        {
          userId: run.userId,
          chargedUnit: 'live_minute',
          chargedAmount: 1,
        },
      );
    } catch (error) {
      // O minuto foi reservado e não foi entregue: devolve o contador e o
      // carimbo ao que eram, senão a próxima tentativa ficaria bloqueada por
      // uma cobrança que nunca aconteceu.
      await this.runs
        .createQueryBuilder()
        .update(LiveRun)
        .set({
          minutesCharged: () => 'GREATEST("minutesCharged" - 1, 0)',
          lastChargedAt: carimboAnterior,
        })
        .where('id = :id', { id: runId })
        .execute();

      const status = error instanceof HttpException ? error.getStatus() : 0;
      if (status !== 402 && status !== 403) throw error;
      run.status = 'erro';
      run.endedAt = new Date();
      run.errorMessage =
        error instanceof HttpException
          ? String(error.getResponse()).slice(0, 500)
          : 'Saldo de minutos esgotado.';
      this.bases.delete(run.id);
      this.logger.warn(`Run ${run.id} encerrada por saldo: ${run.errorMessage}`);
      return this.runs.save(run);
    }

    // Relê para devolver os contadores como o banco os deixou — o `+ 1` foi
    // calculado lá dentro, não aqui.
    const atualizada = (await this.runs.findOneBy({ id: runId })) ?? run;
    if (atualizada.status === 'conectando') {
      atualizada.status = 'ativa';
      return this.runs.save(atualizada);
    }
    return atualizada;
  }

  // ------------------------------------------------------------------ apoio
  /**
   * Serializa a base de forma DETERMINÍSTICA e guarda em memória.
   *
   * A ordenação por id não é estética: o cache da Anthropic é casamento de
   * prefixo byte a byte, e a ordem que o Postgres devolve sem `ORDER BY` não é
   * estável. Uma linha trocando de lugar entre dois lotes invalida a base
   * inteira e a live passa a pagar prefixo cheio a cada 800ms.
   */
  private async baseDaRun(run: LiveRun): Promise<BaseEmMemoria> {
    const cacheada = this.bases.get(run.id);
    if (cacheada) {
      cacheada.usadaEm = Date.now();
      return cacheada;
    }

    const [produtos, faq] = await Promise.all([
      this.produtos.find({
        where: { userId: run.userId, liveSessionId: run.knowledgeSessionId, active: true },
        order: { id: 'ASC' },
      }),
      this.faq.find({
        where: { userId: run.userId, liveSessionId: run.knowledgeSessionId },
        order: { id: 'ASC' },
      }),
    ]);

    const serializada = JSON.stringify({
      produtos: produtos.map((p) => ({
        id: p.id,
        nome: p.name,
        // O preço vai como marcador, não como número: se o valor aparecesse
        // aqui, o modelo o copiaria para a resposta e a substituição perderia o
        // sentido — voltaríamos a depender de o modelo transcrever certo.
        preco: `{{PRECO:${p.id}}}`,
        variantes: p.variants,
        frete: p.shippingInfo,
        promo: p.promo,
        aliases: p.aliases,
      })),
      faq: faq.map((f) => ({
        pergunta: f.question,
        resposta: f.answer,
        tipo: f.kind,
        produtoId: f.liveProductId,
      })),
    });

    const base: BaseEmMemoria = {
      serializada,
      precos: new Map(produtos.map((p) => [p.id, p.priceBrl])),
      produtos: new Set(produtos.map((p) => p.id)),
      chamadas: 0,
      usadaEm: Date.now(),
    };
    this.bases.set(run.id, base);
    return base;
  }

  /**
   * Grita nas primeiras chamadas da run se o cache não pegou.
   *
   * `cache_read_input_tokens` em zero na segunda chamada em diante significa
   * uma de duas coisas, e as duas mudam o custo por minuto: ou a base é curta
   * demais para o mínimo do Haiku, ou algo volátil entrou no prefixo. A
   * primeira é limitação conhecida e não tem conserto; a segunda é bug e
   * precisa aparecer no log antes de virar fatura.
   */
  private conferirCache(run: LiveRun, base: BaseEmMemoria, lidos: number): void {
    if (base.chamadas > 3 || lidos > 0) return;
    const tokensAprox = Math.round(base.serializada.length / CHARS_POR_TOKEN);
    if (tokensAprox < MIN_TOKENS_DE_CACHE_HAIKU) {
      this.logger.log(
        `Run ${run.id}: base com ~${tokensAprox} tokens, abaixo do mínimo de ${MIN_TOKENS_DE_CACHE_HAIKU} do Haiku 4.5 — sem cache, por tamanho. Esperado.`,
      );
      return;
    }
    this.logger.warn(
      `Run ${run.id}: base com ~${tokensAprox} tokens e cache_read zerado na chamada ${base.chamadas}. Há algo volátil no prefixo — o custo por minuto está errado.`,
    );
  }

  /** Insere a mensagem, tolerando a colisão da chave de idempotência. */
  private async gravarMensagem(
    run: LiveRun,
    entrada: MensagemDoChat,
    extras: { normalizado: string; pergunta: boolean; clusterKey: string | null },
  ): Promise<LiveChatMessage | null> {
    try {
      return await this.mensagens.save(
        this.mensagens.create({
          liveRunId: run.id,
          userId: run.userId,
          externalMessageId: entrada.externalMessageId,
          authorHash: entrada.authorHash,
          text: entrada.text,
          receivedAt: entrada.receivedAt ?? new Date(),
          isQuestion: extras.pergunta,
          clusterKey: extras.clusterKey,
          status: 'nova',
          repeatCount: 1,
        }),
      );
    } catch (error) {
      // 23505: já entrou numa reconexão anterior. Reenvio é no-op, por projeto.
      if ((error as { code?: string })?.code === '23505') return null;
      throw error;
    }
  }

  /**
   * As mensagens da run que já perguntavam a mesma coisa.
   *
   * Duas passadas na mesma consulta: casamento exato pela `clusterKey` e
   * quase-igual pelo trigrama do pg_trgm.
   *
   * O FILTRO INTEIRO MORA NO `WHERE` DA TABELA, e isso é o que faz o índice GIN
   * valer alguma coisa. A forma anterior — subconsulta com as 200 mensagens mais
   * recentes e `similarity(text, $) > k` num SELECT externo — não usava índice
   * nenhum: `similarity()` é função, não operador indexável, e mesmo que fosse,
   * aplicá-la sobre um resultado já materializado é tarde demais. Numa live de
   * 40k mensagens isso custava um sort da run inteira a cada 800ms.
   *
   * Quem usa o GIN é o operador `%`, e o limiar dele é o GUC
   * `pg_trgm.similarity_threshold` — daí a transação com `SET LOCAL`: é a única
   * forma de fixar o limiar sem sujar a conexão do pool para as próximas
   * consultas (o `SET LOCAL` morre no commit). A recência, que antes vinha do
   * `LIMIT 200`, agora é uma condição de tempo — indexável pelo par
   * (liveRunId, receivedAt).
   */
  private async irmasDoCluster(
    runId: string,
    mensagem: LiveChatMessage,
    normalizado: string,
  ): Promise<LiveChatMessage[]> {
    if (!normalizado) return [];
    const desde = new Date(Date.now() - JANELA_DO_CLUSTER_MS);
    return this.mensagens.manager.transaction(async (manager) => {
      await manager.query(
        `SET LOCAL pg_trgm.similarity_threshold = ${LIMIAR_SIMILARIDADE}`,
      );
      return (await manager.query(
        `
        SELECT * FROM live_chat_messages
        WHERE "liveRunId" = $1
          AND id <> $2
          AND "isQuestion" = true
          AND "receivedAt" >= $3
          AND ("clusterKey" = $4 OR text % $5)
        ORDER BY "receivedAt" DESC
        LIMIT ${MENSAGENS_PARA_COMPARAR}
        `,
        // O trigrama compara texto CRU com texto CRU: o índice GIN está sobre a
        // coluna `text`, e comparar o cru de um lado com o normalizado do outro
        // desalinharia os trigramas e derrubaria a semelhança de pares que são a
        // mesma pergunta. O normalizado já fez seu trabalho na `clusterKey`.
        [runId, mensagem.id, desde, mensagem.clusterKey, mensagem.text],
      )) as LiveChatMessage[];
    });
  }

  /** Alguma das irmãs já virou resposta nos últimos 90 segundos? */
  private async respondidoRecentemente(
    runId: string,
    idsDasIrmas: string[],
  ): Promise<boolean> {
    if (!idsDasIrmas.length) return false;
    const desde = new Date(Date.now() - JANELA_DE_DUPLICADA_MS);
    const quantas = await this.respostas
      .createQueryBuilder('r')
      .where('r."liveRunId" = :runId', { runId })
      .andWhere('r."chatMessageId" IN (:...ids)', { ids: idsDasIrmas })
      .andWhere('r."createdAt" >= :desde', { desde })
      .getCount();
    return quantas > 0;
  }

  // ------------------------------------------------------------------- cron
  /**
   * Expulsa da memória as bases de lives que pararam de dar sinal.
   *
   * `encerrarRun` cobre o fim educado — o vendedor clicou em encerrar. O fim
   * comum não é educado: o desktop fecha, o notebook dorme, a internet cai, e o
   * batimento simplesmente para (é o que o comentário do heartbeat descreve como
   * normal). Nesse caminho ninguém chama `encerrarRun`, e sem esta varredura a
   * serialização completa do catálogo — dezenas de KB por live — fica retida no
   * processo para sempre. O processo cresceria a cada transmissão até o OOM.
   *
   * Expulsar não perde dado: a base é cache. A próxima chamada de uma run viva
   * remonta do banco; o que se paga é um prefixo frio na Anthropic, uma vez.
   */
  @Cron('*/5 * * * *')
  limparBasesOciosas(): number {
    const limite = Date.now() - TTL_DA_BASE_MS;
    let removidas = 0;
    for (const [runId, base] of this.bases) {
      if (base.usadaEm > limite) continue;
      this.bases.delete(runId);
      removidas += 1;
    }
    if (removidas) {
      this.logger.log(
        `${removidas} base(s) de live sem uso há ${TTL_DA_BASE_MS / 60_000} minutos liberada(s) da memória.`,
      );
    }
    return removidas;
  }

  /**
   * Apaga o texto do chat que passou do prazo de retenção.
   *
   * O autor da mensagem já é anônimo (hash com salt por run), mas o texto é
   * livre e é de TERCEIRO — o espectador nunca foi usuário do PikPok e não
   * assinou nada. E ele escreve dado pessoal ali: "meu cpf é ...", "manda no
   * whats ...". O código sabe disso, tanto que a `LISTA_NEGRA` existe para
   * mandar essas perguntas ao humano — só que a mensagem crua continuava gravada
   * para sempre, e ainda indexada por trigrama.
   *
   * Apaga-se o TEXTO, não a linha: `live_replies` referencia a mensagem com
   * CASCADE, então deletar levaria junto o registro do que o copiloto respondeu
   * ao vendedor — que é serviço prestado e precisa continuar auditável. Sem o
   * texto, o que sobra é contador e cluster, que não identificam ninguém.
   */
  @Cron('0 4 * * *')
  async expurgarChatAntigo(): Promise<number> {
    const limite = new Date(
      Date.now() - DIAS_DE_RETENCAO_DO_CHAT * 24 * 60 * 60_000,
    );
    const resultado = await this.mensagens
      .createQueryBuilder()
      .update(LiveChatMessage)
      .set({ text: '' })
      .where('"receivedAt" < :limite', { limite })
      .andWhere('text <> :vazio', { vazio: '' })
      .execute();

    const apagadas = resultado.affected ?? 0;
    if (apagadas) {
      this.logger.log(
        `Retenção do chat: texto de ${apagadas} mensagem(ns) com mais de ${DIAS_DE_RETENCAO_DO_CHAT} dias apagado.`,
      );
    }
    return apagadas;
  }

  private async acharRun(userId: string, id: string): Promise<LiveRun> {
    const run = await this.runs.findOneBy({ id, userId });
    if (!run) throw new NotFoundException('Transmissão não encontrada.');
    return run;
  }
}
