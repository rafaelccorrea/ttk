import { HttpException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { createHash } from 'node:crypto';
import { In, Repository } from 'typeorm';
import { LIVE_MIN_MINUTES, PLAN_RANK } from '../billing/billing.config';
import { BillingService } from '../billing/billing.service';
import { AiCostService } from '../telemetry/ai-cost.service';
import { killSwitchLigado } from './live-config.service';
import {
  AiService,
  MODELO_FORTE,
  MODELO_RAPIDO,
  RespostaAoVivo,
} from '../studio/ai.service';
import { LiveChatMessage } from './entities/live-chat-message.entity';
import { LiveFaq } from './entities/live-faq.entity';
import { LiveProduct } from './entities/live-product.entity';
import { AppUser } from '../users/entities/app-user.entity';
import {
  LiveReply,
  LiveReplyDecision,
  LiveReplyDeliveryStatus,
} from './entities/live-reply.entity';
import {
  LiveRun,
  LiveRunEndReason,
  LiveRunMode,
} from './entities/live-run.entity';

/**
 * A run bateu o teto de duração do plano?
 *
 * `minutesCharged` é o relógio, e não `startedAt`, de propósito: o contador só
 * anda enquanto o desktop manda batimento — uma live que caiu e voltou horas
 * depois não "envelheceu" no intervalo, porque ninguém foi cobrado nele. Teto
 * zero ou negativo desliga o limite (não existe no catálogo, mas a função não
 * pode transformar um dado ruim em live de zero minutos).
 */
export function excedeuDuracao(
  minutosCobrados: number,
  maxMinutos: number,
): boolean {
  return maxMinutos > 0 && minutosCobrados >= maxMinutos;
}

/**
 * Este minuto ainda está dentro do bloco mínimo pago na abertura da run?
 *
 * A abertura debita `LIVE_MIN_MINUTES` de uma vez (live de menos de dez
 * minutos paga dez — é o piso do produto); os primeiros batimentos então só
 * RESERVAM o minuto para o relógio de duração, sem debitar de novo.
 */
export function dentroDoBlocoMinimo(
  minutosCobradosAntes: number,
  blocoMinimo: number = LIVE_MIN_MINUTES,
): boolean {
  return minutosCobradosAntes < blocoMinimo;
}
import { LiveRunEvent, LiveRunEventTipo } from './entities/live-run-event.entity';
import { LiveRunMetric } from './entities/live-run-metric.entity';
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
 * Semelhança mínima para considerar que a base JÁ responde uma pergunta.
 *
 * Mais alto que o do chat de propósito — o porquê está por extenso em
 * `faqParecida`: aqui, fundir demais sobrescreve resposta curada por gente.
 */
const LIMIAR_FAQ_PARECIDA = 0.8;

/**
 * Limpa a pergunta antes de ela virar linha PERMANENTE da base.
 *
 * O chat tem retenção de 30 dias (`expurgarChatAntigo` apaga o texto). A base de
 * conhecimento não tem — ela é do vendedor e vive enquanto ele quiser. Promover
 * a pergunta de um espectador para dentro dela é tirar um dado de terceiro do
 * regime de retenção e torná-lo permanente, e ainda mandá-lo à OpenAI no
 * `system` de TODA live seguinte, para sempre. É pouco provável e é caro: basta
 * um "meu CEP é 01310-100, chega?" ou "sou a Maria do pedido 4432" para um dado
 * pessoal entrar na base e não sair mais.
 *
 * O que sai é só o que é identificável por FORMA — e-mail, telefone, CPF, CEP,
 * @ e URL. Números soltos ficam: "tem o de 1299?" é uma pergunta sobre preço, e
 * apagar dígitos por precaução destruiria justamente as perguntas que a base
 * existe para responder.
 *
 * A pergunta continua legível porque ela ainda precisa casar por trigrama com as
 * perguntas das próximas lives — trocar por `[removido]` mantém o texto útil e
 * deixa a remoção visível para quem revisar a base.
 */
export function sanitizarPerguntaDaBase(texto: string): string {
  return (texto ?? '')
    // E-mail antes do @ solto: o @ do e-mail não é menção a perfil.
    .replace(/\b[\w.+-]+@[\w-]+\.[\w.-]+\b/g, '[removido]')
    .replace(/https?:\/\/\S+|\bwww\.\S+/gi, '[removido]')
    // CPF com ou sem pontuação.
    .replace(/\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/g, '[removido]')
    // CEP: exige o hífen ou os 8 dígitos seguidos, para não pegar preço.
    .replace(/\b\d{5}-\d{3}\b/g, '[removido]')
    // Telefone brasileiro, com DDD entre parênteses ou não.
    .replace(/(?:\(\d{2}\)\s?|\b\d{2}\s)?\d{4,5}-?\d{4}\b/g, '[removido]')
    .replace(/@[A-Za-z0-9._]{2,}/g, '[removido]')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

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
 * Dentro da janela a repetição é só contada (`repeatCount`) — a resposta já
 * está na tela. Passada a janela, o assunto voltou por conta própria e merece
 * aparecer de novo no painel: mas com a RESPOSTA ANTERIOR do cluster
 * reaproveitada (ver `reaproveitarResposta`), sem chamada ao modelo. Só vai
 * ao modelo quando o cluster nunca teve resposta aprovada.
 *
 * Era 90s e cada repetição depois disso custava uma chamada — cujo resultado,
 * ainda por cima, o banco descartava (uma resposta por mensagem). Três minutos
 * é o tempo de quem entrou agora não ter visto a resposta; o preço que muda ao
 * vivo é coberto pelo vendedor editando a base, o que invalida o cluster.
 */
const JANELA_DE_DUPLICADA_MS = 3 * 60_000;

/** Marcas de "modelo" das respostas que NÃO gastaram token. */
const MODELO_REAPROVEITADO = 'reaproveitada';
const MODELO_FAQ = 'faq';
const MODELO_OUTRA_LIVE = 'outra_live';

/**
 * Similaridade (trigrama) mínima entre a pergunta do chat e a pergunta de
 * uma FAQ para responder DIRETO com a resposta da FAQ, sem modelo.
 *
 * Mais frouxo que `LIMIAR_FAQ_PARECIDA` (0.8), que decide FUNDIR curadoria —
 * ali errar sobrescreve trabalho humano; aqui errar mostra ao vendedor uma
 * resposta pronta da própria base dele, que ele revisa como qualquer outra.
 */
const LIMIAR_FAQ_DIRETA = 0.6;

/**
 * Planos em que a pergunta em cima do muro NÃO sobe ao modelo forte.
 *
 * O segundo passe custa cerca de dez vezes o primeiro por pergunta. No plano
 * de entrada a margem não paga isso; a pergunta fica com o número do modelo
 * rápido e, se ele estiver na faixa de dúvida, vai ao humano — que é o
 * comportamento de antes do reprocesso existir.
 */
const PLANOS_SEM_REPROCESSO = new Set(['essencial']);

/** Por quanto tempo um texto igual a uma resposta emitida é tratado como eco. */
const JANELA_DE_ECO_MS = 10 * 60_000;

/** Tamanho máximo, em caracteres, dos campos livres de produto no prompt. */
const MAX_CARACTERES_CAMPO_LIVRE = 240;

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
 * Prefixo mínimo para o cache pegar, em tokens.
 *
 * A OpenAI só cacheia prompts a partir de 1024 tokens de prefixo. Uma live
 * pequena (três produtos, cinco FAQs) fica abaixo disso e o cache simplesmente
 * não produz entrada nenhuma: sem erro, sem aviso, só `cached_tokens` zerado
 * para sempre. Não há o que fazer no código além de saber que é assim e não
 * sair caçando bug de cache numa base que nunca teve tamanho para cachear —
 * daí este número existir aqui, com nome, e ser usado só para calibrar o
 * alerta abaixo.
 *
 * Era 4096 na Anthropic, que é o piso do Haiku 4.5. O piso menor significa que
 * bases pequenas que NUNCA cacheavam agora passam a cachear.
 */
const MIN_TOKENS_DE_CACHE = 1024;

/** A parte de cada resposta na conta de tokens de uma chamada de lote. */
interface UsoDeTokens {
  prompt: number;
  cached: number;
  completion: number;
}

/** Divide o uso de uma chamada entre as N perguntas que foram juntas. */
function repartirUso(
  lote: { inputTokens?: number; cacheReadTokens?: number; outputTokens?: number },
  quantas: number,
): UsoDeTokens {
  const n = Math.max(1, quantas);
  const cached = lote.cacheReadTokens ?? 0;
  return {
    prompt: Math.round(((lote.inputTokens ?? 0) + cached) / n),
    cached: Math.round(cached / n),
    completion: Math.round((lote.outputTokens ?? 0) / n),
  };
}

/** Corta um campo livre de produto no tamanho que cabe no prompt. */
function enxugar(texto: string | null | undefined): string | null {
  const t = (texto ?? '').trim();
  if (!t) return null;
  return t.length <= MAX_CARACTERES_CAMPO_LIVRE
    ? t
    : t.slice(0, MAX_CARACTERES_CAMPO_LIVRE - 1).trimEnd() + '…';
}

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
  /*
   * Objeção também é pergunta — é a que mais decide compra. "tá caro", "é
   * golpe", "não confio" chegam sem interrogação e sem palavra interrogativa,
   * e ficavam de fora da triagem: a base tem respostas de tipo `objecao`
   * exatamente para elas, e nunca eram acionadas.
   */
  'caro',
  'barato',
  'desconto',
  'cupom',
  'promocao',
  'golpe',
  'confio',
  'confiavel',
  'funciona',
  'vale a pena',
  'garantia',
  'reembolso',
  'cancelar',
  'gratis',
  'teste',
  'pix',
  'boleto',
  'cartao',
  'parcela',
  'dificil',
  'complicado',
  'nao sei',
];

/** Abaixo disto, sem interrogação e sem palavra-chave, é ruído garantido. */
const MIN_CARACTERES_DE_PERGUNTA = 6;

/** Uma mensagem como o app desktop a entrega. */
export interface MensagemDoChat {
  externalMessageId: string;
  authorHash: string;
  text: string;
  receivedAt: Date;
  /** O TikTok a marcou como pergunta (`questionNew`) — ver o DTO. */
  isQuestion?: boolean;
}

/**
 * Perguntas declaradas (cartão de pergunta do TikTok) na frente do lote.
 *
 * A ordem DENTRO de cada grupo é preservada (sort estável): o lote continua
 * cronológico, só que quem usou o cartão — o sinal mais explícito de intenção
 * de compra que o webcast entrega — não espera atrás de "kkkk" e emoji.
 */
export function ordenarPorPrioridade<T extends { isQuestion?: boolean }>(
  lote: T[],
): T[] {
  return [...lote].sort(
    (a, b) => Number(b.isQuestion === true) - Number(a.isQuestion === true),
  );
}

/** A base de uma run, montada uma vez e mantida em memória do processo. */
interface BaseEmMemoria {
  /** A sessão de conhecimento de onde esta base foi montada — é a chave da
   *  invalidação quando o vendedor edita a base NO MEIO da live. */
  sessionId: string;
  serializada: string;
  /** Preço de cada produto, por id — a fonte da verdade do marcador. */
  precos: Map<string, string | null>;
  /** Ids válidos: um id fora daqui numa resposta é alucinação. */
  produtos: Set<string>;
  /**
   * Os valores em dinheiro que a base autoriza a resposta a repetir.
   *
   * Guardado junto da base, e montado uma vez por run, porque é consultado a
   * cada resposta: refazer isso por mensagem seria varrer o catálogo inteiro
   * dentro do caminho quente do motor.
   */
  valoresPermitidos: Set<string>;
  /** Respostas da FAQ, normalizadas — a âncora de `ancoradaNaFaq`. */
  respostasFaq: string[];
  /** Quantas chamadas já foram feitas nesta run (o alerta de cache olha as primeiras). */
  chamadas: number;
  /** Último uso, em ms — é o que a varredura de ociosas olha para expulsar. */
  usadaEm: number;
  /** sha256 de `serializada` — a chave do reaproveitamento entre lives. */
  hash: string;
  /** Plano do dono da run, lido uma vez: decide o reprocesso no modelo forte. */
  plano: string;
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
  if (ehRuido(texto)) return false;
  if (texto?.includes('?')) return true;
  const normalizado = normalizarTexto(texto);
  if (!normalizado) return false;
  if (PALAVRAS_INTERROGATIVAS.some((p) => normalizado.includes(p))) return true;
  // Sem interrogativa e com até duas palavras é saudação, elogio ou nome de
  // cidade ("boa noite", "linda demais", "Belo Horizonte") — não pergunta.
  if (normalizado.split(' ').filter(Boolean).length <= 2) return false;
  return normalizado.length >= MIN_CARACTERES_DE_PERGUNTA * 3;
}

/**
 * O que nunca é pergunta, por forma: só emoji/pontuação, só @menções, ou
 * "kkkk"/"rsrs" e variações. Barrar aqui é de graça; deixar passar custa
 * uma linha de lote e, às vezes, uma resposta inventada no painel.
 */
export function ehRuido(texto: string): boolean {
  const cru = (texto ?? '').trim();
  if (!cru) return true;
  // Sem letras nem dígitos (emoji, coração, "!!!", "...").
  if (!/[\p{L}\p{N}]/u.test(cru)) return true;
  const tokens = cru.split(/\s+/).filter(Boolean);
  // Só @menções ("@fulano @ciclana").
  if (tokens.every((t) => /^@[\w.]+$/.test(t))) return true;
  // Risada e variações, mesmo com pontuação em volta.
  const semPontuacao = cru.replace(/[^\p{L}\p{N}]/gu, '').toLowerCase();
  return /^(k{2,}|(rs){2,}|(ha){2,}|(he){2,}|(kk)+)$/.test(semPontuacao);
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
/**
 * Quanto das palavras da resposta já estava numa resposta da FAQ para ela
 * contar como ANCORADA — isto é, como reprodução do que o vendedor escreveu,
 * e não invenção do modelo.
 *
 * A medida é contenção (palavras da resposta que aparecem na FAQ ÷ palavras
 * da resposta), não Jaccard: a resposta é quase sempre uma versão encurtada
 * da FAQ, e Jaccard puniria justamente o encurtamento. 0,6 deixa o modelo
 * reescrever um terço (conectivos, ordem, tom) sem soltar a âncora; abaixo
 * disso ele está dizendo algo que a FAQ não diz.
 */
const CONTENCAO_MIN_NA_FAQ = 0.6;

/** Palavras curtas demais para servir de evidência de que a frase é a mesma. */
const MIN_LETRAS_DE_PALAVRA = 3;

function palavrasDe(textoNormalizado: string): Set<string> {
  return new Set(
    textoNormalizado.split(' ').filter((p) => p.length >= MIN_LETRAS_DE_PALAVRA),
  );
}

/**
 * A resposta é, na prática, uma resposta da FAQ?
 *
 * Existe porque "resposta pronta exige fonte citada" e o modelo só cita
 * `productIds` — e uma base com muita FAQ conceitual ("isso é live gravada?",
 * "é seguro?") gerava respostas com 0,99 de confiança, copiadas da FAQ, que
 * escalavam para o painel por não terem produto. A FAQ É fonte: o vendedor a
 * escreveu. Casamento por palavras, não pelo modelo, para a âncora não
 * depender de ele lembrar de citar.
 */
export function ancoradaNaFaq(
  respostaNormalizada: string,
  respostasFaqNormalizadas: readonly string[],
): boolean {
  const palavras = palavrasDe(respostaNormalizada);
  if (palavras.size < 3) return false;
  for (const faq of respostasFaqNormalizadas) {
    const daFaq = palavrasDe(faq);
    let comuns = 0;
    for (const p of palavras) if (daFaq.has(p)) comuns += 1;
    if (comuns / palavras.size >= CONTENCAO_MIN_NA_FAQ) return true;
  }
  return false;
}

export function decidirResposta(entrada: {
  confianca: number;
  sourceProductIds: string[];
  perguntaNormalizada: string;
  /** A resposta reproduz uma resposta da FAQ — conta como fonte citada. */
  ancoradaNaFaq?: boolean;
}): LiveReplyDecision {
  const { confianca, sourceProductIds, perguntaNormalizada } = entrada;
  if (confianca < CONFIANCA_ESCALAR) return 'silenciar';
  if (ehListaNegra(perguntaNormalizada)) return 'escalar';
  const temFonte = sourceProductIds.length > 0 || entrada.ancoradaNaFaq === true;
  if (confianca >= CONFIANCA_ENVIAR && temFonte) {
    return 'enviar';
  }
  return 'escalar';
}

/**
 * Reais como o chat lê: "49,90", "1.499,90".
 *
 * O separador de milhar não é preciosismo tipográfico: sem ele o produto de
 * quatro dígitos saía "1499,90", que é como ninguém escreve preço em português
 * — e, pior, era um formato que o detector de preço (`PRECO_ESCRITO`) não
 * reconhecia, deixando a proteção contra corte inerte justamente nos itens mais
 * caros do catálogo. O formato aqui e o detector lá têm de falar a mesma língua.
 */
function formatarPreco(valor: string): string {
  const numero = Number(valor);
  if (!Number.isFinite(numero)) return valor;
  return numero.toLocaleString('pt-BR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
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
 * Traduz o marcador que SOBROU para gente ler.
 *
 * Roda só no caminho da escalação, depois de `resolvido` já ter virado
 * decisão: o rascunho vai para a tela do vendedor, e "{{PRECO:db7f1ece-...}}"
 * na cara dele é lixo de template — a informação real é "esse produto está sem
 * preço na base", que é acionável (ele cadastra o preço e a próxima resposta
 * sai sozinha). Também varre chave órfã de marcador malformado, pelo mesmo
 * motivo.
 */
/**
 * A resposta fala de bastidor? ("a base não informa", "não está cadastrado",
 * "o sistema"...)
 *
 * O cliente da live não sabe — nem deve saber — que existe uma base de
 * conhecimento atrás do chat. Resposta que menciona o bastidor quebra o
 * personagem do vendedor e ainda confessa a limitação em público. O prompt já
 * proíbe; isto é a rede para quando o modelo esquecer. Os padrões são frases
 * ARTICULADAS de propósito: a palavra "base" solta é nome de produto legítimo
 * ("S26 base"), e barrá-la sozinha escalaria resposta certa.
 */
// Sem \b no FIM de propósito: metade das alternativas é prefixo ("informad",
// "cadastrad") que precisa casar "informado/informada/informados".
const META_LINGUAGEM =
  /\b(?:[an]a base|a base (?:não|nao)|base de conhecimento|(?:não|nao) (?:está |esta |foi )?informad|(?:não|nao) (?:está |esta )?cadastrad|sem cadastro|o sistema|meu banco de dados)/i;

export function contemMetaLinguagem(texto: string): boolean {
  return META_LINGUAGEM.test(texto ?? '');
}

export function humanizarMarcadores(texto: string): string {
  return (texto ?? '')
    .replace(/\{\{\s*PRE[CÇ]O\s*:\s*[^}]*?\s*\}\}/gi, '[produto sem preço na base]')
    .replace(/\{\{|\}\}/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

/**
 * Todo número com cara de dinheiro que aparece num texto.
 *
 * Pega "R$ 1.499,90", "49,90", "99 reais" e "50 conto" — a forma como o chat de
 * uma live brasileira escreve valor.
 */
const VALORES_NO_TEXTO =
  /r\$\s*\d[\d.,]*|\d[\d.]*,\d{2}|\b\d+\s*(?:reais|conto|pila)\b/gi;

/** Reduz um valor escrito à sua forma comparável: só os dígitos. */
function digitosDe(valor: string): string {
  return valor.replace(/\D/g, '').replace(/^0+/, '');
}

/**
 * A resposta escreveu um preço que NÃO está na base, por conta própria?
 *
 * A regra dura do produto é "o modelo nunca inventa valor" — para preço de
 * produto ele escreve o marcador e o banco preenche. Instrução de prompt não é
 * garantia disso: basta o Haiku responder "sai por R$ 39,90 hoje!" com um
 * productId válido e confiança 0.9 para o painel entregar um preço alucinado com
 * a mesma cara de um que veio da coluna `priceBrl`.
 *
 * MAS a versão anterior barrava QUALQUER número com cara de dinheiro, e isso
 * inutilizava o modo automático: "frete grátis acima de R$ 99" é informação que
 * o próprio vendedor cadastrou em `shippingInfo`, e ela ia para o painel como se
 * fosse alucinação. Numa base que fala de frete — quase todas —, praticamente
 * nenhuma resposta chegava ao chat.
 *
 * A distinção que importa não é "tem número?", é "esse número é NOSSO?".
 * Reproduzir um valor que consta literalmente na base é reproduzir o que o
 * vendedor escreveu; inventar um valor que não está em lugar nenhum é o risco.
 * Por isso a comparação é por dígitos: "R$ 99", "99 reais" e "99,00" são o mesmo
 * valor escrito de três jeitos, e o modelo escolhe o jeito dele.
 *
 * Roda sobre o texto CRU do modelo, antes da substituição: depois dela o preço
 * legítimo que o banco escreveu estaria lá e a checagem acusaria todo mundo.
 */
export function contemPrecoLiteral(
  texto: string,
  valoresDaBase: Set<string> = new Set(),
): boolean {
  const achados = (texto ?? '').match(VALORES_NO_TEXTO) ?? [];
  return achados.some((achado) => {
    const digitos = digitosDe(achado);
    // Número sem dígito significativo não é valor ("R$" sozinho já é pego pelo
    // marcador não resolvido).
    if (!digitos) return false;
    return !valoresDaBase.has(digitos);
  });
}

/**
 * Os valores que a base autoriza a resposta a repetir.
 *
 * Sai do que o VENDEDOR cadastrou — preço, frete, promoção — e das respostas de
 * FAQ que ele mesmo escreveu. É a lista do que não é invenção do modelo.
 */
export function valoresPermitidos(fontes: {
  precos: Iterable<string>;
  textos: Iterable<string>;
}): Set<string> {
  const permitidos = new Set<string>();
  for (const preco of fontes.precos) {
    const digitos = digitosDe(formatarPreco(preco));
    if (digitos) permitidos.add(digitos);
  }
  for (const texto of fontes.textos) {
    for (const achado of (texto ?? '').match(VALORES_NO_TEXTO) ?? []) {
      const digitos = digitosDe(achado);
      if (digitos) permitidos.add(digitos);
    }
  }
  return permitidos;
}

/** Link ou @menção numa resposta de live é vetor de golpe — não sai daqui. */
export function contemLinkOuMencao(texto: string): boolean {
  return /(https?:\/\/|www\.|\S+\.(com|br|net|shop|store)\b|@\w)/i.test(
    texto ?? '',
  );
}

/* ------------------------- modo automático (fase 2) ----------------------- */

/**
 * A versão vigente do termo de risco do envio automático.
 *
 * Muda junto com o TEXTO do termo, e é a mudança dela que revoga os aceites
 * anteriores: quem clicou na redação de antes consentiu com o risco de antes, e
 * tratar isso como consentimento para a prática nova é o tipo de atalho que
 * transforma "ele aceitou" em nada. Ao subir aqui, todo mundo volta ao modo
 * painel até ler e aceitar de novo — que é o comportamento certo, ainda que
 * incômodo.
 */
export const VERSAO_DO_TERMO_AUTO = '2026-08-17';

/** O aceite guardado autoriza o envio automático HOJE? */
export function aceiteEstaVigente(aceite: {
  liveAutoAcceptedAt: Date | null;
  liveAutoAcceptedVersion: string | null;
}): boolean {
  return (
    !!aceite.liveAutoAcceptedAt &&
    aceite.liveAutoAcceptedVersion === VERSAO_DO_TERMO_AUTO
  );
}

/**
 * O status de entrega com que uma resposta nasce.
 *
 * Só a combinação "run em `auto`" + "decisão `enviar`" produz fila. Todo o
 * resto é `nao_aplica`, inclusive a resposta escalada de uma run automática:
 * escalar quer dizer exatamente "isto não sai sem um humano olhar", e deixá-la
 * `pendente` faria a fila do app conter o que a decisão acabou de barrar.
 */
export function statusInicialDeEntrega(
  modo: LiveRunMode,
  decisao: LiveReplyDecision,
): LiveReplyDeliveryStatus {
  return modo === 'auto' && decisao === 'enviar' ? 'pendente' : 'nao_aplica';
}

/**
 * Para onde cada status de entrega pode ir.
 *
 * `pendente` é o ÚNICO estado de saída, e os três destinos são finais. Isso é o
 * que faz a confirmação ser idempotente sem nenhum controle extra: o app manda
 * "enviada" duas vezes porque a rede engasgou entre a resposta e o ACK, e a
 * segunda simplesmente não encontra transição válida — não há caminho de volta
 * a `pendente` por onde um segundo `repliesSent` pudesse ser contado.
 *
 * `nao_aplica` não vai a lugar nenhum de propósito: uma resposta de modo painel
 * recebendo confirmação de entrega é bug do cliente, e aceitar isso poluiria a
 * métrica com envios que ninguém pediu.
 */
const TRANSICOES_DE_ENTREGA: Record<
  LiveReplyDeliveryStatus,
  LiveReplyDeliveryStatus[]
> = {
  nao_aplica: [],
  pendente: ['enviada', 'falhou', 'cancelada'],
  enviada: [],
  falhou: [],
  cancelada: [],
};

export function podeTransicionarEntrega(
  atual: LiveReplyDeliveryStatus,
  alvo: LiveReplyDeliveryStatus,
): boolean {
  return TRANSICOES_DE_ENTREGA[atual]?.includes(alvo) ?? false;
}

/**
 * Quanto tempo uma resposta aguenta na fila antes de ser descartada.
 *
 * Chat de live rola rápido. Responder uma pergunta de dois minutos atrás é pior
 * que não responder: o contexto já passou, o vendedor já falou outra coisa, e a
 * resposta chega com cara de robô fora de hora — que é exatamente o que faz a
 * audiência (e a moderação do TikTok) perceber a automação. Noventa segundos é
 * a mesma janela que o motor já usa para considerar um cluster "recém
 * respondido": passou disso, o assunto é outro.
 */
export const IDADE_MAXIMA_NA_FILA_MS = 90_000;

/** A resposta ficou na fila além do que o chat aguenta? */
export function expirouNaFila(criadaEm: Date, agora: Date = new Date()): boolean {
  return agora.getTime() - new Date(criadaEm).getTime() > IDADE_MAXIMA_NA_FILA_MS;
}

/**
 * Quantas respostas, no máximo, o app leva por consulta à fila.
 *
 * Digitar comentário é serial e lento — o app não consegue postar dez respostas
 * em três segundos, e se conseguisse não deveria. Devolver mais do que ele
 * consegue entregar só faria a fila expirar dentro do próprio cliente, longe do
 * descarte do servidor.
 */
const TAMANHO_DA_FILA = 5;

/*
 * NÃO EXISTE MAIS um `truncar` simples aqui, e a ausência é deliberada.
 *
 * Havia um: cortava no limite respeitando a palavra, sem saber nada de preço.
 * Ninguém em produção o chamava — só ele mesmo e os testes —, mas um helper
 * chamado "truncar", exportado e aparentemente inofensivo, é um convite para o
 * próximo desenvolvedor cortar uma resposta com ele e reintroduzir a publicação
 * de "R$ 1.4" no chat de alguém.
 *
 * Todo corte de texto que vai ao ar passa por `truncarSeguro`, que devolve
 * também `precoPerdido`. Quem não precisa dessa informação não deveria estar
 * cortando uma resposta.
 */

/**
 * Um preço JÁ ESCRITO pela substituição: "R$ 49,90", "R$ 1.299,00", "R$ 1299,00".
 *
 * O separador de milhar é OPCIONAL de propósito, e essa frouxidão é a correção
 * de um bug que já esteve em produção: o padrão antigo exigia o ponto
 * (`\d{1,3}(?:\.\d{3})*`) enquanto `formatarPreco` escrevia "1499,90" sem ponto
 * nenhum. Resultado: para qualquer produto de quatro dígitos o detector não via
 * preço algum, o corte passava por dentro do valor e o chat da live recebia
 * "…sai por apenas R$" — sem escalar, sem log, marcado como entregue.
 *
 * Casar os dois formatos custa nada e cobre também o que vier de fora do nosso
 * formatador: preço digitado à mão na base pelo vendedor, ou escrito pelo
 * próprio modelo. Um detector de preço que só reconhece o preço que nós mesmos
 * emitimos protege exatamente o caso que nunca falha.
 */
const PRECO_ESCRITO = /R\$\s*\d{1,3}(?:\.\d{3})*,\d{2}|R\$\s*\d+,\d{2}/g;

/**
 * O corte que não pode inventar preço.
 *
 * `truncar` corta por caractere, e depois de `aplicarPrecos` o texto contém o
 * valor real do banco: um corte no meio de "R$ 1.299,00" publica "R$ 1.29" — um
 * preço que a loja não pratica, sem marcador sobrando para escalar e sem
 * `contemPrecoLiteral` para acusar (ele roda sobre o texto CRU do modelo, antes
 * da substituição). Aqui o corte recua para o começo do preço que ele partiria,
 * e o chamador ainda é avisado por `precoPerdido` quando o truncamento tirou um
 * preço que existia — a frase pode continuar prometendo um valor que já não
 * está escrito, e isso vai ao humano.
 */
export function truncarSeguro(
  texto: string,
  max = MAX_CARACTERES,
): { texto: string; precoPerdido: boolean } {
  const limpo = (texto ?? '').replace(/\s+/g, ' ').trim();
  const precos = limpo.match(PRECO_ESCRITO)?.length ?? 0;
  if (limpo.length <= max) return { texto: limpo, precoPerdido: false };

  let corte = max;
  for (const achado of limpo.matchAll(PRECO_ESCRITO)) {
    const inicio = achado.index ?? 0;
    const fim = inicio + achado[0].length;
    if (inicio < corte && fim > corte) {
      corte = inicio;
      break;
    }
  }

  const cortado = limpo.slice(0, corte);
  const espaco = cortado.lastIndexOf(' ');
  const final = (espaco > corte * 0.6 ? cortado.slice(0, espaco) : cortado)
    .replace(/[\s,;:-]+$/, '')
    .trim();

  const restantes = final.match(PRECO_ESCRITO)?.length ?? 0;
  return { texto: final, precoPerdido: restantes < precos };
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
   * perde é o cache quente da OpenAI, não dado.
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
    @InjectRepository(AppUser)
    private readonly usuarios: Repository<AppUser>,
    @InjectRepository(LiveRunMetric)
    private readonly metricas: Repository<LiveRunMetric>,
    @InjectRepository(LiveRunEvent)
    private readonly eventosDaRun: Repository<LiveRunEvent>,
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

    /*
     * O bloco mínimo é debitado NA ABERTURA: live de menos de dez minutos paga
     * dez. Cobrar aqui (e não diluído nos batimentos) faz o 402 acontecer
     * antes de existir run — quem não tem nem o piso de saldo descobre antes
     * de entrar ao vivo, não no primeiro minuto. Os primeiros
     * `LIVE_MIN_MINUTES` batimentos só reservam o minuto, sem debitar de novo
     * (ver `dentroDoBlocoMinimo` em `cobrarMinuto`).
     */
    await this.billing.chargeLiveMinutes(userId, LIVE_MIN_MINUTES);
    void this.custos.registrar(
      'live_reply',
      'cobranca',
      {},
      {
        userId,
        chargedUnit: 'live_minute',
        chargedAmount: LIVE_MIN_MINUTES,
      },
    );

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
    fim?: LiveRunEndReason,
  ): Promise<LiveRun> {
    const run = await this.acharRun(userId, runId);
    // Um fim declarado (ex.: `aviso_tiktok`) é um encerramento DELIBERADO, não
    // uma falha — só o motivo sem fim declarado continua virando `erro`.
    run.status = motivo && !fim ? 'erro' : 'encerrada';
    run.endReason = fim ?? (motivo ? 'erro' : 'manual');
    run.endedAt = new Date();
    if (motivo) run.errorMessage = motivo.slice(0, 500);
    this.bases.delete(run.id);
    // A live acabou: o que estava na fila não tem mais chat onde ser postado.
    await this.cancelarPendentes(run.id, 'A transmissão foi encerrada.');
    return this.runs.save(run);
  }

  /** A run do usuário, com os contadores atualizados. */
  async obterRun(userId: string, runId: string): Promise<LiveRun> {
    return this.acharRun(userId, runId);
  }

  /**
   * Grava um evento de auditoria da run (aviso do TikTok, pin de produto).
   *
   * O detalhe é truncado AQUI além do DTO: este texto vem da tela do TikTok
   * via app do cliente, e o banco é o último lugar onde um payload criativo
   * pode crescer.
   */
  async registrarEvento(
    userId: string,
    runId: string,
    dados: { tipo: LiveRunEventTipo; acao?: string; detalhe?: string },
  ): Promise<void> {
    const run = await this.acharRun(userId, runId);
    await this.eventosDaRun.save(
      this.eventosDaRun.create({
        liveRunId: run.id,
        userId,
        tipo: dados.tipo,
        acao: dados.acao?.slice(0, 40) ?? null,
        detalhe: dados.detalhe?.slice(0, 500) ?? null,
      }),
    );
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

  // ------------------------------------------------- histórico e desempenho
  /**
   * As transmissões do vendedor, com o que aconteceu em cada uma.
   *
   * Estes números já eram gravados desde a fase 1, e até agora existiam só no
   * banco: o vendedor não tinha como saber se o copiloto ajudou. Sem isso, a
   * decisão de renovar o Business vira palpite — e a nossa, de onde mexer no
   * produto, também.
   *
   * A taxa de aproveitamento é a métrica que interessa: das respostas que o
   * copiloto entregou, quantas o vendedor de fato usou. É a única evidência,
   * no modo painel, de que ele acertou — o resto são contadores de atividade,
   * que sobem igual quando o produto está funcionando e quando não está.
   */
  async listarRuns(
    userId: string,
    limite = 30,
  ): Promise<
    Array<{
      id: string;
      status: string;
      mode: string;
      startedAt: Date | null;
      endedAt: Date | null;
      knowledgeSessionId: string;
      messagesSeen: number;
      repliesGenerated: number;
      escalations: number;
      repliesSent: number;
      deliveryFailures: number;
      minutesCharged: number;
      /** Respostas que o vendedor copiou ou salvou na base. */
      repliesUsed: number;
      /** `repliesUsed / repliesGenerated`, ou null quando não houve resposta. */
      usageRate: number | null;
      /** Mediana da latência da run, em ms. Null se não houve resposta. */
      latencyP50Ms: number | null;
      peakViewers: number;
      totalLikes: number;
      totalGifts: number;
      totalGiftDiamonds: number;
      totalFollows: number;
      totalShares: number;
    }>
  > {
    const runs = await this.runs.find({
      where: { userId },
      order: { startedAt: 'DESC', createdAt: 'DESC' },
      take: Math.min(Math.max(Math.trunc(limite), 1), 100),
    });
    if (!runs.length) return [];

    /*
     * Um agregado só para todas as runs, e não uma consulta por run: a tela
     * mostra trinta linhas, e trinta idas ao banco para preencher duas colunas
     * é o N+1 clássico — some numa base de teste com três lives e aparece como
     * tela lenta justamente para o cliente que mais usa o produto.
     *
     * A mediana vem do `percentile_cont` do Postgres em vez de média: uma única
     * resposta que demorou 40s por causa de uma reconexão puxa a média para
     * cima e faz um copiloto rápido parecer lento.
     */
    const agregados = (await this.respostas.manager.query(
      `
      SELECT "liveRunId",
             COUNT(*) FILTER (WHERE "copiedAt" IS NOT NULL) AS usadas,
             percentile_cont(0.5) WITHIN GROUP (ORDER BY "latencyMs") AS p50
      FROM live_replies
      WHERE "liveRunId" = ANY($1)
        AND decision <> 'silenciar'
      GROUP BY "liveRunId"
      `,
      [runs.map((r) => r.id)],
    )) as Array<{ liveRunId: string; usadas: string; p50: string | null }>;

    const porRun = new Map(agregados.map((a) => [a.liveRunId, a] as const));

    return runs.map((run) => {
      const agregado = porRun.get(run.id);
      const usadas = Number(agregado?.usadas ?? 0);
      return {
        id: run.id,
        status: run.status,
        mode: run.mode,
        startedAt: run.startedAt,
        endedAt: run.endedAt,
        knowledgeSessionId: run.knowledgeSessionId,
        messagesSeen: run.messagesSeen,
        repliesGenerated: run.repliesGenerated,
        escalations: run.escalations,
        repliesSent: run.repliesSent,
        deliveryFailures: run.deliveryFailures,
        minutesCharged: run.minutesCharged,
        repliesUsed: usadas,
        // Divisão por zero vira `null`, não `0`: "nenhuma resposta gerada" e
        // "nenhuma das respostas prestou" são coisas diferentes, e mostrá-las
        // como o mesmo 0% acusaria o copiloto de um fracasso que não houve.
        usageRate:
          run.repliesGenerated > 0 ? usadas / run.repliesGenerated : null,
        latencyP50Ms:
          agregado?.p50 != null ? Math.round(Number(agregado.p50)) : null,
        peakViewers: run.peakViewers,
        totalLikes: run.totalLikes,
        totalGifts: run.totalGifts,
        totalGiftDiamonds: run.totalGiftDiamonds,
        totalFollows: run.totalFollows,
        totalShares: run.totalShares,
      };
    });
  }

  /**
   * Grava um lote de instantâneos de audiência e atualiza o resumo da run.
   *
   * Os agregados sobem por SQL incremental (e não relidos + salvos) porque o
   * lote de métricas corre em paralelo com o processamento do chat, que também
   * escreve na run — um save de entidade inteira aqui atropelaria os contadores
   * do funil que outro request acabou de somar.
   */
  async registrarMetricas(
    userId: string,
    runId: string,
    pontos: Array<{
      capturedAt: Date;
      viewerCount?: number;
      likes?: number;
      gifts?: number;
      giftDiamonds?: number;
      follows?: number;
      shares?: number;
      joins?: number;
    }>,
  ): Promise<{ aceitos: number }> {
    const run = await this.acharRun(userId, runId);
    if (!pontos.length) return { aceitos: 0 };

    const linhas = pontos.map((p) =>
      this.metricas.create({
        liveRunId: run.id,
        userId,
        capturedAt: p.capturedAt,
        viewerCount: p.viewerCount ?? null,
        likes: p.likes ?? 0,
        gifts: p.gifts ?? 0,
        giftDiamonds: p.giftDiamonds ?? 0,
        follows: p.follows ?? 0,
        shares: p.shares ?? 0,
        joins: p.joins ?? 0,
      }),
    );
    await this.metricas.save(linhas);

    const soma = (campo: keyof LiveRunMetric) =>
      linhas.reduce((acc, l) => acc + (Number(l[campo]) || 0), 0);
    const picoDoLote = Math.max(
      0,
      ...linhas.map((l) => l.viewerCount ?? 0),
    );

    await this.runs
      .createQueryBuilder()
      .update(LiveRun)
      .set({
        totalLikes: () => `"totalLikes" + ${soma('likes')}`,
        totalGifts: () => `"totalGifts" + ${soma('gifts')}`,
        totalGiftDiamonds: () =>
          `"totalGiftDiamonds" + ${soma('giftDiamonds')}`,
        totalFollows: () => `"totalFollows" + ${soma('follows')}`,
        totalShares: () => `"totalShares" + ${soma('shares')}`,
        peakViewers: () => `GREATEST("peakViewers", ${picoDoLote})`,
      })
      .where('id = :id', { id: run.id })
      .execute();

    return { aceitos: linhas.length };
  }

  /**
   * A live inteira, para a página de detalhe na web: o resumo da run, a série
   * de audiência e o que foi perguntado e respondido.
   *
   * As perguntas vêm da junção com as respostas — e não "toda mensagem do
   * chat" — porque é isso que a página conta: o que o copiloto fez. As
   * escaladas entram mesmo sem resposta, porque são justamente as lacunas que o
   * vendedor precisa rever. O chat bruto (saudação, emoji, spam) fica de fora:
   * tem retenção de 30 dias e não conta história nenhuma.
   */
  async detalharRun(userId: string, runId: string) {
    const run = await this.acharRun(userId, runId);

    const [serie, respostas, escaladas] = await Promise.all([
      this.metricas.find({
        where: { liveRunId: run.id },
        order: { capturedAt: 'ASC' },
      }),
      this.respostas.find({
        where: { liveRunId: run.id },
        relations: { chatMessage: true },
        order: { createdAt: 'ASC' },
      }),
      this.mensagens.find({
        where: { liveRunId: run.id, status: 'escalada' },
        order: { receivedAt: 'ASC' },
      }),
    ]);

    const respondidas = new Set(respostas.map((r) => r.chatMessageId));

    return {
      ...this.resumoDaRun(run, respostas),
      metricas: serie.map((m) => ({
        capturedAt: m.capturedAt,
        viewerCount: m.viewerCount,
        likes: m.likes,
        gifts: m.gifts,
        giftDiamonds: m.giftDiamonds,
        follows: m.follows,
        shares: m.shares,
        joins: m.joins,
      })),
      qa: [
        ...respostas
          // `silenciar` não vai à página pelo mesmo motivo que não vai ao
          // painel: é o que o próprio copiloto considerou fraco.
          .filter((r) => r.decision !== 'silenciar')
          .map((r) => ({
            chatMessageId: r.chatMessageId,
            question: r.chatMessage?.text ?? '',
            repeatCount: r.chatMessage?.repeatCount ?? 1,
            receivedAt: r.chatMessage?.receivedAt ?? r.createdAt,
            answer: r.text,
            decision: r.decision,
            confidence: Number(r.confidence),
            latencyMs: r.latencyMs,
            copiedAt: r.copiedAt,
            deliveryStatus: r.deliveryStatus,
            sentAt: r.sentAt,
            failureReason: r.failureReason,
          })),
        ...escaladas
          .filter((m) => !respondidas.has(m.id))
          .map((m) => ({
            chatMessageId: m.id,
            question: m.text,
            repeatCount: m.repeatCount,
            receivedAt: m.receivedAt,
            answer: null,
            decision: 'escalar' as const,
            confidence: null,
            latencyMs: null,
            copiedAt: null,
            deliveryStatus: 'nao_aplica' as const,
            sentAt: null,
            failureReason: null,
          })),
      ].sort(
        (a, b) =>
          new Date(a.receivedAt).getTime() - new Date(b.receivedAt).getTime(),
      ),
    };
  }

  /** O mesmo formato de linha de `listarRuns`, para uma run só. */
  private resumoDaRun(run: LiveRun, respostas: LiveReply[]) {
    const visiveis = respostas.filter((r) => r.decision !== 'silenciar');
    const usadas = visiveis.filter((r) => r.copiedAt != null).length;
    const latencias = visiveis
      .map((r) => r.latencyMs)
      .filter((n) => n > 0)
      .sort((a, b) => a - b);
    return {
      id: run.id,
      status: run.status,
      mode: run.mode,
      startedAt: run.startedAt,
      endedAt: run.endedAt,
      knowledgeSessionId: run.knowledgeSessionId,
      tiktokUsername: run.tiktokUsername,
      messagesSeen: run.messagesSeen,
      repliesGenerated: run.repliesGenerated,
      escalations: run.escalations,
      repliesSent: run.repliesSent,
      deliveryFailures: run.deliveryFailures,
      minutesCharged: run.minutesCharged,
      repliesUsed: usadas,
      usageRate:
        run.repliesGenerated > 0 ? usadas / run.repliesGenerated : null,
      latencyP50Ms: latencias.length
        ? latencias[Math.floor(latencias.length / 2)]
        : null,
      peakViewers: run.peakViewers,
      totalLikes: run.totalLikes,
      totalGifts: run.totalGifts,
      totalGiftDiamonds: run.totalGiftDiamonds,
      totalFollows: run.totalFollows,
      totalShares: run.totalShares,
    };
  }

  // ------------------------------------------- realimentação da base (f. 3)
  /**
   * Guarda na base uma resposta que o vendedor aprovou no painel.
   *
   * É o único ponto do produto em que ele fica melhor sozinho. Toda pergunta
   * que o copiloto escalou é uma lacuna da base — e a resposta que o vendedor
   * deu (ou corrigiu) é exatamente o que faltava. Sem esta rota, o mesmo buraco
   * escala de novo na live seguinte, e na outra: o vendedor paga o modelo toda
   * vez para receber "não sei" sobre algo que ele já explicou três vezes.
   *
   * Vai para a SESSÃO DE CONHECIMENTO, não para a run. A run acaba junto com a
   * transmissão; a base é reaproveitada por todas as próximas, que é onde o
   * aprendizado precisa aparecer.
   *
   * Nasce com `origin: 'manual'` mesmo quando o texto veio inteiro do modelo.
   * A origem aqui não é sobre quem digitou, é sobre **quem responde por aquilo**
   * — e um humano leu e aprovou. Isso muda o tratamento: `origin: 'ia'` é
   * apagável em massa no reprocessamento da live (ver `gravarBase`), e perder a
   * curadoria do vendedor porque ele reenviou a gravação seria destruir o único
   * dado do sistema que não dá para refazer.
   */
  async promoverParaBase(
    userId: string,
    replyId: string,
    textoEditado?: string,
  ): Promise<LiveFaq> {
    const resposta = await this.respostas.findOneBy({ id: replyId, userId });
    if (!resposta) throw new NotFoundException('Resposta não encontrada.');

    const run = await this.runs.findOneBy({ id: resposta.liveRunId, userId });
    if (!run) throw new NotFoundException('Transmissão não encontrada.');

    const mensagem = await this.mensagens.findOneBy({
      id: resposta.chatMessageId,
    });
    if (!mensagem) {
      throw new NotFoundException(
        'A pergunta que originou esta resposta já não está guardada.',
      );
    }

    const pergunta = sanitizarPerguntaDaBase(mensagem.text);
    const texto = (textoEditado ?? resposta.text).trim();
    if (!texto) {
      throw new HttpException('A resposta não pode ficar vazia.', 400);
    }

    /*
     * Aprovar é usar. O carimbo de cópia é a métrica de qualidade da fase
     * painel, e salvar na base é um sinal ainda mais forte do que copiar — não
     * marcá-lo aqui faria a taxa de acerto ler como pior justamente nos casos
     * em que o copiloto mais ajudou.
     */
    if (!resposta.copiedAt) {
      resposta.copiedAt = new Date();
      await this.respostas.save(resposta);
    }

    const existente = await this.faqParecida(run.knowledgeSessionId, pergunta);
    if (existente) {
      /*
       * A mesma dúvida já está na base. Continua sendo UMA linha (duas
       * respostas concorrentes para a mesma pergunta cairiam no desempate por
       * prioridade), mas o conteúdo AGREGA em vez de sobrescrever: ensinar não
       * pode apagar o que a base já sabia — o vendedor que acrescenta "tem
       * garantia de 1 ano" não está pedindo para esquecer o prazo de entrega
       * que estava na mesma resposta. Só não agrega o repetido: ensinar a
       * mesma frase duas vezes não pode duplicá-la.
       */
      const atual = existente.answer?.trim() ?? '';
      if (normalizarTexto(atual) !== normalizarTexto(texto) && !atual.includes(texto)) {
        existente.answer = atual ? `${atual} ${texto}` : texto;
      }
      existente.origin = 'manual';
      existente.priority = Math.max(existente.priority, 0) + 1;
      const corrigida = await this.faq.save(existente);
      this.invalidarBasesDaSessao(run.knowledgeSessionId);
      return corrigida;
    }

    const criada = await this.faq.save(
      this.faq.create({
        liveSessionId: run.knowledgeSessionId,
        userId,
        question: pergunta,
        answer: texto,
        kind: 'faq',
        origin: 'manual',
        /*
         * Só amarra ao produto quando a resposta se apoiou em UM. Com dois ou
         * mais a pergunta era comparativa ("qual rende mais?"), e prendê-la a
         * um deles faria a entrada sumir da base no dia em que aquele item for
         * apagado — levando junto uma resposta que valia para os dois.
         */
        liveProductId:
          resposta.sourceProductIds?.length === 1
            ? resposta.sourceProductIds[0]
            : null,
        priority: 1,
      }),
    );
    this.invalidarBasesDaSessao(run.knowledgeSessionId);
    return criada;
  }

  /**
   * Joga fora a base em memória de toda run que bebe desta sessão.
   *
   * É o que faz o "Ensinar" valer AINDA NESTA LIVE: sem isto, a resposta
   * salva ia para o banco e a run ativa continuava respondendo com a base
   * serializada de quando conectou — o vendedor ensinava e via a mesma
   * pergunta escalar de novo, como se o ensino não tivesse pegado (só pegava
   * na live seguinte). O próximo lote remonta a base do banco.
   *
   * O custo assumido: invalidar quebra o prefixo do cache da OpenAI e o lote
   * seguinte paga a base cheia UMA vez. É o preço de a correção valer agora —
   * e edição de base no meio da live é evento raro, não rotina de 800ms.
   */
  invalidarBasesDaSessao(knowledgeSessionId: string): void {
    for (const [runId, base] of this.bases) {
      if (base.sessionId === knowledgeSessionId) this.bases.delete(runId);
    }
  }

  /**
   * Uma entrada da base que já responde esta mesma pergunta, se houver.
   *
   * Mesmo trigrama do dedup do chat, e pelo mesmo motivo: ninguém repete uma
   * pergunta com as mesmas palavras. "chega quando?", "quanto tempo pra chegar"
   * e "prazo de entrega" são a mesma dúvida, e sem a comparação por semelhança
   * a base engorda com três linhas quase idênticas a cada live — o que estraga
   * duas coisas de uma vez: o prompt fica maior (e mais caro) e o modelo passa a
   * escolher entre respostas concorrentes para a mesma pergunta.
   *
   * Limiar mais alto que o do chat (0,80 contra 0,65) porque o custo do erro é
   * invertido. No chat, fundir demais deixa alguém sem resposta ao vivo; aqui,
   * fundir demais SOBRESCREVE uma resposta que o vendedor tinha curado. Errar
   * para o lado de criar uma linha a mais é barato — ele apaga; errar para o
   * lado de sobrescrever apaga trabalho dele sem avisar.
   */
  private async faqParecida(
    sessionId: string,
    pergunta: string,
    limiar: number = LIMIAR_FAQ_PARECIDA,
  ): Promise<LiveFaq | null> {
    if (!pergunta) return null;
    const linhas = await this.faq.manager.transaction(async (manager) => {
      await manager.query(
        `SET LOCAL pg_trgm.similarity_threshold = ${limiar}`,
      );
      return (await manager.query(
        `
        SELECT * FROM live_faq
        WHERE "liveSessionId" = $1
          AND question % $2
        ORDER BY priority DESC, "createdAt" ASC
        LIMIT 1
        `,
        [sessionId, pergunta],
      )) as LiveFaq[];
    });
    if (!linhas.length) return null;
    // A consulta crua devolve linha solta, não entidade: recarrega pelo
    // repositório para que o `save` a seguir seja um UPDATE, e não um INSERT.
    return this.faq.findOneBy({ id: linhas[0].id });
  }

  // -------------------------------------------------- modo automático (f. 2)
  /**
   * Liga ou desliga o envio automático de uma transmissão em andamento.
   *
   * O aceite do termo é conferido A CADA vez que se pede `auto`, e não uma vez
   * na conta: o que autoriza a automação é uma decisão informada do dono da
   * conta que vai levar o ban, e ela precisa estar registrada ANTES do primeiro
   * comentário postado. Um cliente adulterado mandando `mode: auto` direto na
   * rota é o caminho óbvio, e é ele que esta checagem fecha.
   *
   * Voltar para `painel` não pede nada e nunca falha — degradar tem que ser a
   * operação barata. O que já está na fila é CANCELADO junto: são respostas
   * escritas para um chat que o vendedor acabou de decidir não automatizar, e
   * deixá-las pendentes faria o app postá-las depois de o modo ter mudado.
   */
  async trocarModo(
    userId: string,
    runId: string,
    modo: LiveRunMode,
  ): Promise<LiveRun> {
    const run = await this.acharRun(userId, runId);
    if (run.status === 'encerrada' || run.status === 'erro') {
      throw new HttpException('Esta transmissão já foi encerrada.', 409);
    }
    if (run.mode === modo) return run;

    if (modo === 'auto') {
      /*
       * O kill switch da frota barra AQUI também, e não só na configuração que
       * o app baixa. O que ele desliga é o envio de todo mundo em sessenta
       * segundos, sem release — e isso não pode depender de o app obedecer ao
       * `killSwitch` que recebeu: um app velho, ou adulterado, chamaria esta
       * rota do mesmo jeito. A leitura é direta do ambiente, e não pelo
       * `LiveConfigService`, para não criar dependência circular entre o motor
       * e a configuração que fala sobre ele; a definição canônica vive em
       * `live-config.service.ts` (`killSwitchLigado`).
       */
      if (process.env.LIVE_ENVIO_KILL_SWITCH === 'true') {
        throw new HttpException(
          'O envio automático está pausado pelo PikPok no momento. As respostas continuam aparecendo no painel para você copiar.',
          423,
        );
      }
      const dono = await this.usuarios.findOneBy({ id: userId });

      /*
       * O envio automático continua exclusivo do Business, mesmo agora que o
       * Pro alcança o copiloto.
       *
       * A razão nunca foi preço, foi risco: o modo automático é o único lugar
       * do produto em que escrevemos DENTRO da plataforma do vendedor, em nome
       * dele, contrariando os Termos do TikTok — e quem leva o ban é ele. Esse
       * degrau é o que vem com suporte de gente do outro lado quando algo dá
       * errado ao vivo.
       *
       * O Pro fica com o modo painel, que entrega o valor central (a resposta
       * certa, na hora certa, com o preço certo) sem tocar no chat. É por isso
       * que dar o copiloto ao Pro não afrouxa nada: o que ele ganha é a metade
       * sem risco.
       */
      if ((PLAN_RANK[dono?.plan ?? 'free'] ?? 0) < PLAN_RANK.business) {
        throw new HttpException(
          'O envio automático no chat é exclusivo do plano Business. No seu plano o copiloto responde no painel, para você copiar ou falar em voz alta.',
          403,
        );
      }

      if (!dono || !aceiteEstaVigente(dono)) {
        throw new HttpException(
          'Para o copiloto responder sozinho no chat você precisa aceitar o termo de risco: enviar comentários automaticamente contraria os Termos de Uso do TikTok e pode levar à suspensão da sua conta. Aceite o termo nas configurações e tente de novo.',
          412,
        );
      }
    }

    run.mode = modo;
    const salva = await this.runs.save(run);

    /*
     * O cancelamento vem DEPOIS de o modo ficar gravado, e a ordem é a trava da
     * corrida: `processarLote` leva segundos no modelo e materializa a resposta
     * com o modo que releu do banco. Cancelando antes, uma resposta em voo
     * nasceria `pendente` depois da limpeza e ficaria órfã na fila de uma run
     * que já voltou ao painel. Com o modo gravado primeiro, ou a materialização
     * enxerga `painel` e nem cria a pendência, ou ela criou antes e o
     * cancelamento abaixo a alcança.
     */
    if (modo !== 'auto') {
      await this.cancelarPendentes(
        run.id,
        'A transmissão voltou para o modo painel.',
      );
    }
    this.logger.log(`Run ${run.id}: modo de resposta alterado para '${modo}'.`);
    return salva;
  }

  /**
   * A fila de respostas aprovadas esperando o app digitar no chat.
   *
   * Ordenada da mais antiga para a mais nova porque a live é uma conversa: a
   * pergunta que chegou primeiro é a que ainda tem contexto na tela. O teto é
   * pequeno de propósito (ver `TAMANHO_DA_FILA`) — o gargalo é o app digitando,
   * não a consulta.
   *
   * O descarte por idade não é feito aqui, e sim no @Cron: se a fila só
   * limpasse quando alguém consultasse, um app que travou deixaria respostas
   * `pendente` para sempre e a taxa de entrega da live nunca fecharia.
   */
  async filaDeEnvio(userId: string, runId: string): Promise<LiveReply[]> {
    const run = await this.acharRun(userId, runId);
    /*
     * A fila só existe enquanto a run está em `auto` e de pé. Sem este corte,
     * uma transmissão encerrada por saldo — ou que voltou ao painel numa corrida
     * — continuaria servindo `pendente` para o app postar no chat. É a última
     * barreira, e ela olha o estado ATUAL da run, não o de quando a resposta
     * nasceu.
     */
    if (
      run.mode !== 'auto' ||
      run.status === 'encerrada' ||
      run.status === 'erro'
    ) {
      return [];
    }

    /*
     * O kill switch também vale AQUI, e não só na configuração que o app baixa.
     *
     * Confiar apenas no cliente para respeitar o desligamento é confiar num
     * binário que roda na máquina de outra pessoa: uma versão antiga que ainda
     * não releu a config, um app que perdeu a rede depois de encher a fila, ou
     * alguém que simplesmente edite o código continuariam puxando respostas e
     * postando no chat depois de nós termos desligado a frota. O kill switch
     * existe para o dia em que o TikTok apertar a detecção — nesse dia ele
     * precisa ser uma barreira do servidor, não um pedido educado.
     *
     * Os pendentes não são cancelados: se o switch voltar dentro da janela de
     * validade, a fila segue de onde parou; o que passou da idade morre no cron.
     */
    if (killSwitchLigado()) {
      this.logger.warn(
        `Run ${runId}: fila de envio negada — kill switch ligado.`,
      );
      return [];
    }

    return this.respostas.find({
      relations: { chatMessage: true },
      where: {
        liveRunId: runId,
        decision: 'enviar',
        deliveryStatus: 'pendente',
      },
      order: { createdAt: 'ASC' },
      take: TAMANHO_DA_FILA,
    });
  }

  /**
   * O app conta o que aconteceu com a resposta que tirou da fila.
   *
   * IDEMPOTENTE POR CONSTRUÇÃO, e o custo de não ser é concreto: o app confirma
   * uma entrega, a conexão cai antes do ACK e ele repete a confirmação — se a
   * segunda passasse, `repliesSent` contaria dois envios que foram um só, e a
   * métrica que decide se o modo automático fica de pé viraria ficção. Quem
   * garante isso é a tabela de transições: `enviada` é final, então a repetição
   * não encontra caminho e vira no-op silencioso.
   *
   * O contador da run é incrementado no MESMO passo em que a transição é aceita
   * — nunca antes, nunca "por via das dúvidas".
   */
  async confirmarEntrega(
    userId: string,
    replyId: string,
    status: LiveReplyDeliveryStatus,
    failureReason?: string | null,
  ): Promise<LiveReply> {
    const resposta = await this.respostas.findOneBy({ id: replyId, userId });
    if (!resposta) throw new NotFoundException('Resposta não encontrada.');

    if (!podeTransicionarEntrega(resposta.deliveryStatus, status)) {
      /*
       * Não é erro: é a repetição chegando, ou o app confirmando algo que o
       * descarte por idade já cancelou enquanto ele digitava. Devolver o estado
       * atual deixa o cliente se reconciliar sem tratar exceção — e um 409 aqui
       * só o faria tentar de novo, que é o oposto do que se quer.
       */
      this.logger.debug(
        `Resposta ${replyId}: confirmação '${status}' ignorada — já estava em '${resposta.deliveryStatus}'.`,
      );
      return resposta;
    }

    /*
     * A transição é um UPDATE CONDICIONAL, e não uma leitura seguida de
     * escrita, pelo mesmo motivo da reserva do minuto em `cobrarMinuto`: duas
     * confirmações simultâneas — o app repetindo porque o ACK não chegou —
     * leriam as duas o mesmo `pendente` e ambas concluiriam que podem contar.
     * Com a condição dentro do próprio UPDATE, o Postgres decide, e exatamente
     * uma volta com `affected = 1`. Só ela mexe no contador da run.
     */
    const transicao = await this.respostas
      .createQueryBuilder()
      .update(LiveReply)
      .set({
        deliveryStatus: status,
        deliveryAttempts: () => '"deliveryAttempts" + 1',
        sentAt: status === 'enviada' ? new Date() : resposta.sentAt,
        failureReason: failureReason
          ? failureReason.slice(0, 500)
          : resposta.failureReason,
      })
      .where('id = :id', { id: replyId })
      .andWhere('"deliveryStatus" = :atual', { atual: resposta.deliveryStatus })
      .execute();

    if (!transicao.affected) {
      // Alguém confirmou entre a leitura e o UPDATE. Quem chegou primeiro vale.
      return (await this.respostas.findOneBy({ id: replyId })) ?? resposta;
    }

    if (status === 'enviada') {
      await this.runs.increment({ id: resposta.liveRunId }, 'repliesSent', 1);
    } else if (status === 'falhou') {
      await this.runs.increment(
        { id: resposta.liveRunId },
        'deliveryFailures',
        1,
      );
    }
    return (await this.respostas.findOneBy({ id: replyId })) ?? resposta;
  }

  /** Cancela em bloco o que ainda não saiu de uma run. */
  private async cancelarPendentes(
    runId: string,
    motivo: string,
  ): Promise<number> {
    const resultado = await this.respostas
      .createQueryBuilder()
      .update(LiveReply)
      .set({ deliveryStatus: 'cancelada', failureReason: motivo })
      .where('"liveRunId" = :runId', { runId })
      .andWhere(`"deliveryStatus" = 'pendente'`)
      .execute();
    return resultado.affected ?? 0;
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
    const reaproveitadas: LiveReply[] = [];

    for (const entrada of ordenarPorPrioridade(lote)) {
      const normalizado = normalizarTexto(entrada.text);
      // Pergunta declarada pelo espectador fura a heurística: quem abriu o
      // cartão de pergunta não pode ser descartado como ruído.
      const pergunta = entrada.isQuestion === true || ehPergunta(entrada.text);
      const clusterKey = normalizado ? clusterKeyDe(normalizado) : null;

      const mensagem = await this.gravarMensagem(run, entrada, {
        normalizado,
        pergunta,
        clusterKey,
      });
      // Colisão da chave de idempotência: o app reenviou o que já entrou.
      if (!mensagem) continue;
      gravadas.push(mensagem);

      /*
       * A segunda trava contra o eco: o desktop já descarta o que a conta do
       * vendedor escreve, mas o backend não confia no cliente. Uma "pergunta"
       * cujo texto é uma resposta recente desta run (com ou sem o "@fulano: "
       * na frente) é o app lendo a si mesmo — e responder a isso é o laço que
       * gasta saldo conversando sozinho.
       */
      if (pergunta && (await this.ehEcoDeResposta(run.id, entrada.text))) {
        mensagem.status = 'ignorada';
        await this.mensagens.save(mensagem);
        continue;
      }

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
        /*
         * Cluster antigo o suficiente para voltar ao painel. Se o cluster já
         * teve uma resposta APROVADA, ela serve de novo: mesma pergunta, mesma
         * base, mesmo preço — chamar o modelo seria pagar pela mesma frase.
         * A resposta nova nasce presa à mensagem NOVA (uma resposta por
         * mensagem é restrição do banco), com o mesmo texto e as mesmas fontes.
         */
        const anterior = await this.ultimaRespostaAprovada(
          run.id,
          irmas.map((m) => m.id),
        );
        if (anterior) {
          const reuso = await this.reaproveitarResposta(run, base, mensagem, anterior, comecou);
          if (reuso) {
            reaproveitadas.push(reuso);
            continue;
          }
        }
        // Nunca respondida (ou só escalada): tenta sem modelo e, no fim, vai
        // ao modelo carregando o peso do cluster — é o `repeatCount` que o
        // prompt usa como pressão.
        mensagem.repeatCount = original.repeatCount;
        const semModelo = await this.responderSemModelo(run, base, mensagem, normalizado, comecou);
        if (semModelo) {
          reaproveitadas.push(semModelo);
          continue;
        }
        paraResponder.set(mensagem.id, mensagem);
        continue;
      }

      // Pergunta nova nesta live: antes do modelo, a FAQ da base e o que a
      // mesma base já respondeu em outra live.
      const semModelo = await this.responderSemModelo(run, base, mensagem, normalizado, comecou);
      if (semModelo) {
        reaproveitadas.push(semModelo);
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
      return { respostas: reaproveitadas, escaladas };
    }

    const geradas = await this.gerarRespostas(
      run,
      base,
      [...paraResponder.values()],
      comecou,
    );
    return {
      respostas: [...reaproveitadas, ...geradas.respostas],
      escaladas: [...escaladas, ...geradas.escaladas],
    };
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
      modelo: MODELO_RAPIDO,
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

    const usoDoLote = repartirUso(lote, mensagens.length);
    const usoPorMensagem = new Map(mensagens.map((m) => [m.id, { ...usoDoLote }]));

    if (reprocessar.length && PLANOS_SEM_REPROCESSO.has(base.plano)) {
      this.logger.log(
        `Run ${run.id}: ${reprocessar.length} pergunta(s) em cima do muro ficam sem o modelo forte (plano ${base.plano}).`,
      );
      reprocessar.length = 0;
    }

    if (reprocessar.length) {
      const segundo = await this.ai.responderChatDaLive({
        baseSerializada: base.serializada,
        perguntas: reprocessar.map((m) => ({
          messageId: m.id,
          texto: m.text,
          repeticoes: m.repeatCount,
        })),
        modelo: MODELO_FORTE,
        userId: run.userId,
      });
      base.chamadas += 1;
      for (const r of segundo.respostas) porId.set(r.messageId, r);
      const usoDoSegundo = repartirUso(segundo, reprocessar.length);
      for (const m of reprocessar) {
        const uso = usoPorMensagem.get(m.id);
        if (!uso) continue;
        uso.prompt += usoDoSegundo.prompt;
        uso.cached += usoDoSegundo.cached;
        uso.completion += usoDoSegundo.completion;
      }
      this.logger.log(
        `Run ${run.id}: ${reprocessar.length} pergunta(s) de alto valor reprocessada(s) no Opus.`,
      );
    }

    const modeloDe = (id: string) =>
      reprocessar.some((m) => m.id === id) ? MODELO_FORTE : lote.model;

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
        usoPorMensagem.get(mensagem.id),
      );
      /*
       * A mensagem vai PENDURADA na resposta, só em memória: o controller
       * precisa do `authorHash` dela para o evento `reply`, e já a temos aqui —
       * buscar de novo seria uma consulta por resposta num laço que roda a
       * cada lote. Não passa por `save`, então o banco não vê nada disso.
       */
      resposta.chatMessage = mensagem;
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
    uso?: UsoDeTokens,
  ): Promise<LiveReply> {
    const normalizado = normalizarTexto(mensagem.text);
    // Só ids que existem na base contam como fonte: um id inventado é o
    // contrário de uma âncora, e passaria a alucinação como se fosse prova.
    const fontes = (bruta.productIds ?? []).filter((id) =>
      base.produtos.has(id),
    );
    const preco = aplicarPrecos(bruta.text ?? '', base.precos);
    // O marcador que sobrou JÁ decidiu a escalação (abaixo); daqui em diante o
    // texto é rascunho para humano ler, e uuid de template não se lê.
    const legivel = preco.resolvido ? preco.texto : humanizarMarcadores(preco.texto);
    const corte = truncarSeguro(legivel);
    const texto = corte.texto;

    let confianca = Number(bruta.confidence);
    if (!Number.isFinite(confianca)) confianca = 0;
    confianca = Math.min(Math.max(confianca, 0), 1);

    let decisao = decidirResposta({
      confianca,
      sourceProductIds: fontes,
      perguntaNormalizada: normalizado,
      ancoradaNaFaq:
        fontes.length === 0 &&
        ancoradaNaFaq(normalizarTexto(texto), base.respostasFaq),
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
    if (contemPrecoLiteral(bruta.text ?? '', base.valoresPermitidos)) {
      decisao = 'escalar';
      this.logger.warn(
        `Run ${run.id}: o modelo escreveu um valor que NÃO está na base em vez de usar {{PRECO:id}} — resposta escalada. Conferir a instrução do prompt.`,
      );
    }
    /*
     * O truncamento comeu um preço que a substituição tinha escrito. O texto
     * que sobrou pode seguir prometendo um valor que já não está lá ("sai por
     * apenas") — e publicar isso no chat é o mesmo estrago do preço alucinado.
     */
    if (corte.precoPerdido) {
      decisao = 'escalar';
      this.logger.warn(
        `Run ${run.id}: a resposta passou de ${MAX_CARACTERES} caracteres e o corte atingiu um preço — resposta escalada.`,
      );
    }
    // Link ou @menção: nunca vai pronto ao painel, mesmo confiante.
    if (contemLinkOuMencao(texto)) decisao = 'escalar';
    // Fala de bastidor ("a base não informa") quebra o personagem do vendedor
    // na frente do cliente: vira rascunho para ele reescrever com a voz dele.
    if (contemMetaLinguagem(texto)) decisao = 'escalar';
    if (!texto) decisao = 'silenciar';

    return this.gravarResposta(run, base, mensagem, {
      texto,
      confianca,
      decisao,
      fontes,
      model,
      comecou,
      uso,
    });
  }

  /**
   * As respostas que não custam token, em ordem de confiança:
   *
   *  1. A FAQ da própria base, quando a pergunta do chat é parecida o bastante
   *     com a pergunta cadastrada — é a resposta que o vendedor ESCREVEU;
   *  2. O que a MESMA base (byte a byte, pelo hash) já respondeu para o mesmo
   *     cluster em outra live — "o primeiro preço de cada live" deixa de ser
   *     uma chamada.
   *
   * Lista negra continua indo ao humano, e resposta com marcador, link ou
   * fala de bastidor não sai daqui — as mesmas regras da resposta gerada.
   */
  private async responderSemModelo(
    run: LiveRun,
    base: BaseEmMemoria,
    mensagem: LiveChatMessage,
    normalizado: string,
    comecou: number,
  ): Promise<LiveReply | null> {
    if (!normalizado || ehListaNegra(normalizado)) return null;

    const faq = await this.faqParecida(run.knowledgeSessionId, mensagem.text, LIMIAR_FAQ_DIRETA);
    const resposta = (faq?.answer ?? '').trim();
    if (
      faq &&
      resposta &&
      !resposta.includes('{{') &&
      !contemLinkOuMencao(resposta) &&
      !contemMetaLinguagem(resposta)
    ) {
      const corte = truncarSeguro(resposta);
      if (!corte.precoPerdido && corte.texto) {
        try {
          return await this.gravarResposta(run, base, mensagem, {
            texto: corte.texto,
            confianca: 0.95,
            decisao: 'enviar',
            fontes: faq.liveProductId ? [faq.liveProductId] : [],
            model: MODELO_FAQ,
            comecou,
          });
        } catch (error) {
          this.logger.warn(`Run ${run.id}: FAQ direta falhou: ${(error as Error).message}`);
        }
      }
    }

    if (!mensagem.clusterKey) return null;
    const deOutraLive = await this.respostaDeOutraLive(run, base.hash, mensagem.clusterKey);
    if (!deOutraLive) return null;
    return this.reaproveitarResposta(run, base, mensagem, deOutraLive, comecou, MODELO_OUTRA_LIVE);
  }

  /** A resposta aprovada mais recente do mesmo cluster, com a mesma base, em OUTRA live. */
  private async respostaDeOutraLive(
    run: LiveRun,
    baseHash: string,
    clusterKey: string,
  ): Promise<LiveReply | null> {
    const linhas = (await this.respostas.query(
      `
      SELECT r.*
      FROM live_replies r
      JOIN live_chat_messages m ON m.id = r."chatMessageId"
      WHERE r."userId" = $1
        AND r."baseHash" = $2
        AND m."clusterKey" = $3
        AND r.decision = 'enviar'
        AND r."liveRunId" <> $4
        AND r.text <> ''
      ORDER BY r."createdAt" DESC
      LIMIT 1
      `,
      [run.userId, baseHash, clusterKey, run.id],
    )) as LiveReply[];
    return linhas[0] ?? null;
  }

  /** A persistência da resposta — gerada pelo modelo ou reaproveitada. */
  private async gravarResposta(
    run: LiveRun,
    base: BaseEmMemoria,
    mensagem: LiveChatMessage,
    dados: {
      texto: string;
      confianca: number;
      decisao: LiveReplyDecision;
      fontes: string[];
      model: string;
      comecou: number;
      uso?: UsoDeTokens;
    },
  ): Promise<LiveReply> {
    const { texto, confianca, decisao, fontes, model, comecou, uso } = dados;
    mensagem.status = decisao === 'enviar' ? 'respondida' : 'escalada';
    if (decisao === 'silenciar') mensagem.status = 'ignorada';
    await this.mensagens.save(mensagem);

    /*
     * O modo é RELIDO do banco, e não aproveitado do `run` que o lote carregou:
     * entre o início do processamento e este ponto passaram os segundos da
     * chamada ao modelo, e é justamente aí que o vendedor aperta "voltar para o
     * painel". Nascer `pendente` com o modo velho colocaria na fila uma resposta
     * que o cancelamento já não alcança.
     */
    const atual = await this.runs.findOne({
      where: { id: run.id },
      select: { id: true, mode: true, status: true },
    });
    const modoAgora = atual?.mode ?? run.mode;
    const runViva = atual
      ? atual.status !== 'encerrada' && atual.status !== 'erro'
      : true;

    try {
      const salva = await this.respostas.save(
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
          promptTokens: uso ? uso.prompt : null,
          cachedTokens: uso ? uso.cached : null,
          completionTokens: uso ? uso.completion : null,
          baseHash: base.hash,
          // A fila do modo automático nasce aqui, e só aqui: quem entra é o que
          // a decisão já aprovou, com o modo lido da run e não de um parâmetro
          // do cliente.
          deliveryStatus: runViva
            ? statusInicialDeEntrega(modoAgora, decisao)
            : 'nao_aplica',
        }),
      );

      /*
       * A segunda metade da trava: a troca para `painel` (ou o encerramento)
       * pode ter acontecido entre a leitura acima e este INSERT. Como o modo é
       * gravado ANTES do cancelamento em massa, uma releitura aqui fecha a
       * janela — o que nasceu pendente para uma run que já não está em `auto`
       * morre imediatamente, em vez de esperar o app tirá-lo da fila.
       */
      if (salva.deliveryStatus === 'pendente') {
        const conferida = await this.runs.findOne({
          where: { id: run.id },
          select: { id: true, mode: true, status: true },
        });
        const aindaAutomatica =
          conferida?.mode === 'auto' &&
          conferida.status !== 'encerrada' &&
          conferida.status !== 'erro';
        if (!aindaAutomatica) {
          await this.respostas.update(
            { id: salva.id, deliveryStatus: 'pendente' },
            {
              deliveryStatus: 'cancelada',
              failureReason: 'A transmissão saiu do modo automático.',
            },
          );
          salva.deliveryStatus = 'cancelada';
        }
      }
      return salva;
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

    /*
     * O teto de duração do plano é checado ANTES da reserva: o minuto que
     * estoura o teto não é cobrado nem contado. É um fim NORMAL (status
     * `encerrada`, não `erro`) — a live cumpriu o que o plano vende; quem
     * decide se o degrau de cima vale a pena é o vendedor, avisado pelo
     * evento `duration_limit_reached` no fluxo.
     */
    const tetoDeDuracao = await this.billing.liveDurationLimitMinutes(
      run.userId,
    );
    if (excedeuDuracao(run.minutesCharged, tetoDeDuracao)) {
      run.status = 'encerrada';
      run.endReason = 'limite_duracao';
      run.endedAt = new Date();
      this.bases.delete(run.id);
      await this.cancelarPendentes(
        run.id,
        'A transmissão atingiu o limite de duração do plano.',
      );
      this.logger.log(
        `Run ${run.id} encerrada por limite de duração (${tetoDeDuracao} min).`,
      );
      return this.runs.save(run);
    }

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

    /*
     * Os primeiros `LIVE_MIN_MINUTES` já foram pagos na abertura (bloco
     * mínimo): o batimento continua RESERVANDO o minuto — é ele o relógio de
     * duração — mas não debita nem registra receita de novo.
     */
    const minutoPrepago = dentroDoBlocoMinimo(run.minutesCharged);
    try {
      if (!minutoPrepago) {
        await this.billing.chargeLiveMinutes(run.userId, 1);
        /*
         * A receita do copiloto ao vivo entra no relatório de margem AQUI, e
         * não na chamada do modelo, porque custo e receita acontecem em
         * momentos diferentes: o custo nasce a cada resposta gerada, a receita
         * nasce no relógio. Registrar um evento de custo zero com o minuto
         * cobrado é o que fecha a conta — sem ele, `live_reply` apareceria com
         * todo o custo e receita nenhuma, e o relatório leria como prejuízo
         * permanente um recurso que está pago.
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
      }
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
      run.endReason = 'creditos';
      run.endedAt = new Date();
      run.errorMessage =
        error instanceof HttpException
          ? String(error.getResponse()).slice(0, 500)
          : 'Saldo de minutos esgotado.';
      this.bases.delete(run.id);
      /*
       * Encerrar por saldo tem que limpar a fila como qualquer outro
       * encerramento: o que ficou `pendente` foi escrito para uma live que já
       * acabou, e deixá-lo lá é deixar o app postá-lo no chat depois do fim.
       */
      await this.cancelarPendentes(
        run.id,
        'A transmissão foi encerrada por falta de minutos.',
      );
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
   * A ordenação por id não é estética: o cache da OpenAI é casamento de
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

    const [produtos, faq, sessao, dono] = await Promise.all([
      this.produtos.find({
        where: { userId: run.userId, liveSessionId: run.knowledgeSessionId, active: true },
        order: { id: 'ASC' },
      }),
      this.faq.find({
        where: { userId: run.userId, liveSessionId: run.knowledgeSessionId },
        order: { id: 'ASC' },
      }),
      this.sessoes.findOne({
        where: { id: run.knowledgeSessionId, userId: run.userId },
        select: { id: true, title: true, context: true },
      }),
      this.usuarios.findOne({
        where: { id: run.userId },
        select: { id: true, plan: true },
      }),
    ]);

    const serializada = JSON.stringify({
      // O "sobre o que é esta live" vem ANTES dos produtos e é estável durante
      // a run (editar derruba esta base): prefixo cacheável, como o resto.
      live: {
        titulo: sessao?.title ?? null,
        contexto: sessao?.context ?? null,
      },
      produtos: produtos.map((p) => ({
        id: p.id,
        nome: p.name,
        // O preço vai como marcador, não como número: se o valor aparecesse
        // aqui, o modelo o copiaria para a resposta e a substituição perderia o
        // sentido — voltaríamos a depender de o modelo transcrever certo.
        preco: `{{PRECO:${p.id}}}`,
        variantes: p.variants,
        // Campos livres entram ENXUTOS: cada caractere aqui vai em toda
        // chamada da live. O que o vendedor escreveu além disso continua na
        // base (e nos valores permitidos) — só não cabe no prompt.
        frete: enxugar(p.shippingInfo),
        promo: enxugar(p.promo),
        detalhes: enxugar(p.details),
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
      sessionId: run.knowledgeSessionId,
      serializada,
      precos: new Map(produtos.map((p) => [p.id, p.priceBrl])),
      produtos: new Set(produtos.map((p) => p.id)),
      /*
       * O que a resposta pode repetir sem ser acusada de inventar valor: os
       * preços dos produtos e QUALQUER número em dinheiro que o vendedor já
       * escreveu no frete, na promoção ou numa resposta de FAQ. É o que separa
       * "reproduziu o que está cadastrado" de "tirou um número do nada".
       */
      respostasFaq: faq.map((f) => normalizarTexto(f.answer ?? '')).filter(Boolean),
      valoresPermitidos: valoresPermitidos({
        precos: produtos
          .map((p) => p.priceBrl)
          .filter((p): p is string => Boolean(p)),
        textos: [
          ...produtos.flatMap((p) => [
            p.shippingInfo ?? '',
            p.promo ?? '',
            // Os detalhes entram pelo mesmo motivo do frete: um valor em
            // dinheiro que o vendedor ESCREVEU ali ("garantia cobre até R$
            // 200") é dele — a resposta pode repeti-lo sem ser acusada de
            // inventar número.
            p.details ?? '',
          ]),
          ...faq.map((f) => f.answer ?? ''),
        ],
      }),
      chamadas: 0,
      usadaEm: Date.now(),
      hash: createHash('sha256').update(serializada).digest('hex'),
      plano: dono?.plan ?? 'free',
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
    if (tokensAprox < MIN_TOKENS_DE_CACHE) {
      this.logger.log(
        `Run ${run.id}: base com ~${tokensAprox} tokens, abaixo do mínimo de ${MIN_TOKENS_DE_CACHE} da OpenAI — sem cache, por tamanho. Esperado.`,
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
    /*
     * O desempate por id na ordenação abaixo NÃO é decoração: numa rajada o
     * webcast entrega várias mensagens com o MESMO instante de recebimento, e aí
     * "a mais antiga do cluster" — que é quem carrega o contador de repetição e
     * a resposta já dada — passava a ser escolhida por ordem indeterminada do
     * Postgres — e desempatar por id não resolve, porque UUID é aleatório: "a
     * mais antiga" sairia sorteada. Quem reflete a ordem real de gravação é o
     * createdAt. Cada duplicata elegia uma original diferente e o cluster se
     * fragmentava: a mesma pergunta gerava duas respostas, duas linhas no painel
     * do vendedor e duas linhas de custo.
     *
     * Foi assim que a simulação de live pegou o defeito — quatro variações de
     * "quanto custa o kit" no mesmo milissegundo, todas com semelhança acima do
     * limiar, e ainda assim duas respostas saindo.
     */
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
        ORDER BY "receivedAt" DESC, "createdAt" DESC
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

  /** O texto é uma resposta que esta run já emitiu nos últimos minutos? */
  private async ehEcoDeResposta(runId: string, texto: string): Promise<boolean> {
    const semPrefixo = (texto ?? '').replace(/^@?[w.]{2,40}:s*/u, '').trim();
    if (!semPrefixo) return false;
    const desde = new Date(Date.now() - JANELA_DE_ECO_MS);
    const quantas = await this.respostas
      .createQueryBuilder('r')
      .where('r."liveRunId" = :runId', { runId })
      .andWhere('r."createdAt" >= :desde', { desde })
      .andWhere('(r.text = :texto OR r.text = :cru)', { texto: semPrefixo, cru: (texto ?? '').trim() })
      .getCount();
    return quantas > 0;
  }

  /** A resposta aprovada mais recente do cluster, dentro da janela dele. */
  private async ultimaRespostaAprovada(
    runId: string,
    idsDasIrmas: string[],
  ): Promise<LiveReply | null> {
    if (!idsDasIrmas.length) return null;
    const [ultima] = await this.respostas.find({
      where: {
        liveRunId: runId,
        chatMessageId: In(idsDasIrmas),
        decision: 'enviar',
      },
      order: { createdAt: 'DESC' },
      take: 1,
    });
    return ultima && ultima.text ? ultima : null;
  }

  /**
   * Grava, para a mensagem nova, uma cópia da resposta anterior do cluster.
   *
   * Sem modelo, sem preço para resolver, sem decisão para tomar: tudo isso já
   * foi feito quando a resposta original passou. O que se repete é só a
   * persistência — com o mesmo respeito ao modo atual da run que a resposta
   * gerada tem (`gravarResposta`).
   */
  private async reaproveitarResposta(
    run: LiveRun,
    base: BaseEmMemoria,
    mensagem: LiveChatMessage,
    anterior: LiveReply,
    comecou: number,
    model: string = MODELO_REAPROVEITADO,
  ): Promise<LiveReply | null> {
    try {
      return await this.gravarResposta(run, base, mensagem, {
        texto: anterior.text,
        confianca: Number(anterior.confidence) || 0,
        decisao: 'enviar',
        fontes: anterior.sourceProductIds ?? [],
        model,
        comecou,
      });
    } catch (error) {
      this.logger.warn(
        `Run ${run.id}: falhou ao reaproveitar resposta ${anterior.id}: ${(error as Error).message}`,
      );
      return null;
    }
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
   * remonta do banco; o que se paga é um prefixo frio na OpenAI, uma vez.
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
   * Descarta o que envelheceu na fila do modo automático.
   *
   * Uma resposta certa postada tarde demais é PIOR que nenhuma resposta. O chat
   * já rolou, o vendedor já falou de outro produto, e o comentário chega
   * respondendo uma pergunta que ninguém lembra de ter feito — que é como
   * automação se denuncia, tanto para a audiência quanto para quem modera. Por
   * isso o descarte é ativo e não depende do app: se ele travou, congelou ou
   * ficou preso num captcha, a fila continua envelhecendo do lado de cá e
   * precisa morrer sozinha.
   *
   * A cada trinta segundos para um limite de noventa: uma resposta é descartada
   * no máximo meio minuto depois de vencer, e a varredura é um UPDATE com
   * filtro indexado sobre uma fatia minúscula da tabela.
   *
   * `cancelada` e não `falhou`: nada foi tentado, nada quebrou. Contar isso como
   * falha de entrega faria uma live com app lento parecer uma live com a
   * automação bloqueada, e as duas pedem reações opostas.
   */
  @Cron('*/30 * * * * *')
  async descartarFilaVelha(): Promise<number> {
    const limite = new Date(Date.now() - IDADE_MAXIMA_NA_FILA_MS);
    const resultado = await this.respostas
      .createQueryBuilder()
      .update(LiveReply)
      .set({
        deliveryStatus: 'cancelada',
        failureReason:
          'Descartada: o chat da live já tinha passado do assunto quando a resposta ficou pronta para envio.',
      })
      .where(`"deliveryStatus" = 'pendente'`)
      .andWhere('"createdAt" < :limite', { limite })
      .execute();

    const descartadas = resultado.affected ?? 0;
    if (descartadas) {
      this.logger.log(
        `Fila do modo automático: ${descartadas} resposta(s) descartada(s) por passar de ${IDADE_MAXIMA_NA_FILA_MS / 1000}s sem sair.`,
      );
    }
    return descartadas;
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
