import { ForbiddenException, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AppUser } from '../users/entities/app-user.entity';
import { LiveSelectorFailure } from './entities/live-selector-failure.entity';
/*
 * A versão vigente do termo e o teste de vigência moram no motor, e são
 * importados daqui em vez de reescritos: o texto (abaixo) e a versão precisam
 * subir JUNTOS, e duas constantes de versão em dois arquivos é a forma mais
 * rápida de o termo exibido deixar de ser o termo carimbado. A dependência é de
 * mão única — o motor não conhece este serviço.
 */
import {
  aceiteEstaVigente,
  VERSAO_DO_TERMO_AUTO,
} from './live-reply.service';

/**
 * A configuração do ENVIO AUTOMÁTICO, servida pelo backend.
 *
 * O motivo de isto não morar no código do Electron é operacional, não estético.
 * O TikTok reescreve o HTML da live sem avisar ninguém, e quando o seletor do
 * campo de comentário muda, ele não quebra para um usuário: quebra para a frota
 * inteira no mesmo instante. Se a cascata de seletores estivesse compilada
 * dentro do app, consertar exigiria build, assinatura, publicação na atualização
 * automática e — o pior degrau — o vendedor ACEITAR atualizar. São dias, no
 * melhor caso, com o produto morto no meio. Servida daqui, a mesma correção é um
 * deploy nosso e chega no próximo pedido de configuração de todo mundo.
 *
 * NÃO HÁ TABELA para isto, e é decisão: seletor e limite são configuração de
 * operação, não dado de cliente. Uma tabela criaria um segundo lugar onde a
 * verdade pode estar (o código diz uma coisa, a linha diz outra), migration para
 * mudar valor e um caminho de escrita a proteger. Constante no código,
 * sobrescrita por variável de ambiente, cabe no mesmo deploy que a correção.
 */

/**
 * A versão da cascata. É um número que só sobe, e existe para dois usos que se
 * fecham em ciclo: o app manda esta versão junto com a telemetria de falha, e
 * assim sabemos se quem quebrou já estava com o seletor novo ou ainda com o
 * velho em cache. Sem ela, todo relatório de falha seria ambíguo.
 *
 * SUBA ESTE NÚMERO SEMPRE que mexer nos seletores abaixo.
 */
const VERSAO_DOS_SELETORES = 1;

/**
 * A cascata do campo de comentário, em ordem de preferência.
 *
 * A ordem não é arbitrária e é o coração desta configuração:
 *
 * 1. `[data-e2e="..."]` vem primeiro porque atributos `data-e2e` são ganchos de
 *    TESTE do próprio TikTok. Eles existem para a suíte automatizada deles não
 *    quebrar a cada refatoração de CSS — ou seja, são justamente o que o time de
 *    front deles tem incentivo para manter estável. Classes utilitárias e nomes
 *    ofuscados (`css-1a2b3c-DivInput`) mudam a cada build; o `data-e2e` costuma
 *    sobreviver a redesigns inteiros.
 * 2. Depois vêm os seletores ESTRUTURAIS — papel ARIA, `contenteditable`,
 *    `placeholder` — porque descrevem o que o elemento É, não como ele foi
 *    escrito. Um campo de comentário continua sendo um campo editável com rótulo
 *    de comentário mesmo depois de trocarem a folha de estilo inteira.
 * 3. Por último, os seletores por classe/estrutura de DOM. São os mais frágeis e
 *    por isso são a rede de segurança, nunca a primeira tentativa: se o app
 *    tentasse a classe primeiro, ele acharia o elemento ERRADO com frequência
 *    (uma div de layout que casa por acidente) em vez de simplesmente não achar
 *    nada — e digitar no lugar errado é pior que não digitar.
 *
 * O app tenta na ordem e para no primeiro que casar. Quando NENHUM casa, ele
 * reporta em `POST live/telemetry/selector-failure`, e é esse sinal que abre o
 * trabalho de publicar seletor novo.
 */
const SELETORES_CAMPO = [
  '[data-e2e="comment-text-input"]',
  '[data-e2e="comment-input"]',
  'div[contenteditable="true"][role="textbox"]',
  'div[contenteditable="true"][aria-label*="oment"]',
  'input[placeholder*="oment"]',
  '.public-DraftEditor-content[contenteditable="true"]',
];

/** Mesma lógica de ordem do campo: `data-e2e`, depois papel, depois classe. */
const SELETORES_BOTAO_ENVIAR = [
  '[data-e2e="comment-post"]',
  '[data-e2e="comment-submit"]',
  'button[type="submit"][aria-label*="nvia"]',
  'button[aria-label*="ost comment"]',
  'div[role="button"][aria-label*="oment"]',
];

/**
 * O intervalo mínimo entre dois envios.
 *
 * Oito segundos é lento de propósito. O que distingue um vendedor de um bot, aos
 * olhos de qualquer heurística de detecção, é a CADÊNCIA: humano não posta a
 * cada 400ms, e um ritmo regular e rápido é a assinatura mais fácil de casar.
 * Perder uma pergunta por estar em cooldown custa uma resposta; ser marcado como
 * automação custa a conta do vendedor.
 */
const COOLDOWN_MS = 8000;

/** Teto por minuto — o mesmo raciocínio do cooldown, agora sobre a janela. */
const MAX_POR_MINUTO = 12;

/** O TikTok aceita 150; 140 é o mesmo teto que o motor já aplica ao gerar. */
const MAX_CARACTERES = 140;

/**
 * Quanto o app espera antes de conferir se o comentário apareceu mesmo no chat.
 *
 * Clicar em enviar não é enviar: o TikTok engole comentário calado por
 * moderação, rate limit próprio ou sessão expirada. Sem a verificação, o app
 * marcaria como entregue algo que nunca saiu, e o vendedor descobriria pelo
 * cliente reclamando que ninguém respondeu. Quatro segundos cobrem o round-trip
 * do webcast sem prender o próximo envio.
 */
const VERIFICACAO_MS = 4000;

/** Quantos caracteres do HTML reportado sobrevivem à gravação. */
const MAX_HTML_AMOSTRA = 4000;

/**
 * Quantos caracteres de UM atributo sobrevivem.
 *
 * Nome de classe, `data-e2e` e `role` cabem folgados nisso; frase de gente, não.
 * O limite é o que impede um `aria-label` (ou um `data-*` qualquer que o TikTok
 * invente amanhã) de virar o canal por onde o comentário do espectador entra na
 * tabela de diagnóstico.
 */
const MAX_ATRIBUTO = 40;

/**
 * O que conta como rótulo de INTERFACE num `aria-label`.
 *
 * É a mesma família de palavras que a cascata de descoberta procura no cliente —
 * o que interessa saber é "este elemento se anuncia como o campo de comentário /
 * o botão de enviar". Qualquer outro conteúdo é, para nós, indistinguível de
 * texto de espectador, e por isso não é guardado.
 */
const ROTULO_DE_INTERFACE =
  /(coment|comment|diga algo|say something|enviar|send|post|buscar|search|curtir|like|compartilhar|share|fechar|close)/i;

/**
 * Atributos que a amostra de diagnóstico pode carregar com valor.
 *
 * Allowlist, e não lista de proibidos, porque o HTML é de outra empresa e muda
 * sem aviso: um atributo novo que eles inventem entra no nosso banco por
 * omissão se a regra for "remover os que eu conheço". O que precisamos para
 * escrever um seletor novo é a ESTRUTURA — tag, classe, papel, tipo —, nunca o
 * conteúdo.
 */
const ATRIBUTOS_COM_VALOR = new Set([
  'class',
  'role',
  'type',
  'name',
  'contenteditable',
  'disabled',
  'aria-disabled',
  'data-e2e',
]);

/**
 * O termo, em português claro e sem eufemismo.
 *
 * Está escrito para ser LIDO, não para constar. Quem liga o envio automático
 * precisa entender, antes de clicar, que o risco recai sobre a conta dele — e a
 * redação evasiva ("pode haver limitações na plataforma") é justamente a que faz
 * o usuário ignorar o aviso e depois dizer, com razão, que não foi avisado.
 */
export const TERMO_DE_ENVIO_AUTOMATICO = [
  'Envio automático de respostas no chat da live',
  '',
  'Ao ativar este recurso, o PikPok vai DIGITAR E PUBLICAR comentários no chat da sua live, em seu nome, usando a sua sessão do TikTok.',
  '',
  'O que você precisa saber antes de ligar:',
  '',
  '1. Publicar comentários de forma automatizada VIOLA os Termos de Serviço do TikTok. Não existe permissão oficial para isso.',
  '2. O TikTok pode, a qualquer momento e sem aviso, limitar o alcance da sua live, bloquear seus comentários, suspender ou BANIR a sua conta.',
  '3. Esse risco é seu. O PikPok não tem como impedir uma punição do TikTok, não responde por ela e não indeniza perda de conta, de audiência ou de vendas.',
  '4. Nós reduzimos o risco (ritmo humano, limite por minuto e um botão que desliga o envio de todos os usuários de uma vez), mas reduzir não é eliminar.',
  '5. Você continua responsável pelo que é publicado em seu nome. Acompanhe o painel durante a live.',
  '',
  'Se você prefere não correr esse risco, use o modo somente-painel: o PikPok escreve a resposta pronta na sua tela e VOCÊ decide se envia. O resultado de venda é praticamente o mesmo.',
].join('\n');

/** O que o app desktop recebe para decidir como (e se) envia. */
export interface ConfigDeEnvio {
  version: number;
  killSwitch: boolean;
  seletores: { campo: string[]; botaoEnviar: string[] };
  limites: {
    cooldownMs: number;
    maxPorMinuto: number;
    maxCaracteres: number;
    verificacaoMs: number;
  };
  mensagem?: string;
}

/* -------------------------------------------------------------------------- *
 *  Leitura do ambiente — funções puras, sem estado                            *
 * -------------------------------------------------------------------------- */

function numeroDoAmbiente(chave: string, padrao: number): number {
  const bruto = process.env[chave];
  if (bruto === undefined || bruto.trim() === '') return padrao;
  const valor = Number(bruto);
  // Valor inválido não pode virar NaN silencioso: um cooldown NaN no app vira
  // envio sem intervalo nenhum, que é exatamente o que o cooldown existe para
  // impedir. Na dúvida, o padrão do código — que é sempre seguro.
  return Number.isFinite(valor) && valor > 0 ? valor : padrao;
}

/**
 * Lista de seletores vinda do ambiente, separada por `|`.
 *
 * A barra vertical, e não a vírgula, porque seletor CSS usa vírgula como "ou"
 * (`a, b`) — separar por vírgula transformaria um seletor composto em dois
 * quebrados, e a cascata inteira falharia de um jeito difícil de enxergar.
 */
function listaDoAmbiente(chave: string, padrao: string[]): string[] {
  const bruto = process.env[chave];
  if (!bruto) return padrao;
  const lista = bruto
    .split('|')
    .map((s) => s.trim())
    .filter(Boolean);
  return lista.length ? lista : padrao;
}

/**
 * O kill switch da frota.
 *
 * Existe para uma situação específica e previsível: o TikTok aperta a detecção
 * (ou nos chega o primeiro relato de conta banida) e precisamos que NINGUÉM
 * esteja enviando dentro de um minuto. Com esta variável, isso é mudar um valor
 * no ambiente e reiniciar — sessenta segundos, sem release, sem esperar ninguém
 * atualizar o app. É a diferença entre desligar o risco e assistir a ele.
 *
 * Ligado, todo mundo cai para somente-painel: o copiloto continua gerando a
 * resposta e mostrando na tela, e o vendedor copia. O produto degrada, não para.
 */
export function killSwitchLigado(): boolean {
  return process.env.LIVE_ENVIO_KILL_SWITCH === 'true';
}

/**
 * Tira do HTML reportado tudo que possa ser texto de gente.
 *
 * A REGRA É DURA: nenhum caractere digitado por um espectador — ou pelo próprio
 * vendedor — pode entrar nesta tabela. O container que o app captura envolve o
 * chat da live, então o HTML cru vem cheio de comentário de terceiro: nome,
 * telefone, "meu cpf é...", tudo que a `LISTA_NEGRA` do motor já reconhece como
 * dado pessoal. Essas pessoas nunca foram usuárias do PikPok e não há base legal
 * nenhuma para guardar o que elas escreveram numa tabela de diagnóstico.
 *
 * E não precisamos disso. Para escrever um seletor novo o que serve é a
 * ESTRUTURA: nomes de tag, `data-*`, `role`, `aria-label`, `class`, `id`. O
 * conteúdo entre as tags é ruído para nós e risco para elas — então some aqui,
 * no servidor, antes de qualquer gravação ou log. Sanear no cliente não bastaria:
 * o payload é do cliente e um cliente adulterado manda o que quiser.
 */
export function sanitizarHtml(html: string): string {
  const semScripts = (html ?? '')
    // Script e style trazem conteúdo inteiro embutido, incluindo estado
    // serializado da página — que é onde o chat aparece em texto puro.
    .replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, '<$1></$1>')
    .replace(/<!--[\s\S]*?-->/g, '');

  const semTexto = semScripts
    /*
     * Todo texto ENTRE tags vira nada. É o filtro que faz o trabalho: o que
     * sobra é o esqueleto de tags, que é exatamente o que precisamos ler.
     */
    .replace(/>([^<]*)</g, '><')
    /*
     * Atributos que carregam texto livre ou identidade de terceiro saem
     * INTEIROS. `value`, `placeholder`, `title` e `alt` recebem o que foi
     * digitado; `href` carrega o perfil de quem comentou (`/@fulano`), `src` e
     * `srcset` o avatar com o id do espectador, `style` e `content` texto
     * arbitrário. Nada disso ajuda a escrever um seletor novo, e todos são
     * dado pessoal de gente que nunca foi cliente do PikPok.
     */
    .replace(
      /\s(value|placeholder|title|alt|href|xlink:href|src|srcset|data-src|poster|action|content|style|download|aria-labelledby|aria-describedby|aria-placeholder)\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi,
      '',
    )
    /*
     * O que sobra é estrutura — tag, `class`, `id`, `role`, `data-*` — e ela é
     * normalizada aqui, nas TRÊS formas válidas de valor em HTML (aspas duplas,
     * simples e sem aspas): escrever a regra só para aspas duplas deixava
     * passar, em tamanho integral, exatamente o
     * `aria-label='<comentário do espectador>'`.
     *
     * `aria-label` é o caso especial e o mais perigoso: é rótulo de interface —
     * logo, seletor em potencial e informação que queremos ver — mas nada impede
     * o TikTok de despejar ali o texto da mensagem ("Maria disse: meu cpf é
     * ..."). Truncar não resolve: os primeiros quarenta caracteres do comentário
     * de alguém ainda são o comentário de alguém. Então o VALOR só sobrevive
     * quando é reconhecidamente rótulo de UI (a mesma família de palavras que a
     * cascata de descoberta procura); em qualquer outro caso o atributo fica,
     * vazio, dizendo apenas que existe.
     */
    .replace(
      /\s([a-zA-Z_:][-\w:.]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g,
      (inteiro, nome: string, aspasDuplas, aspasSimples, semAspas) => {
        const chave = String(nome).toLowerCase();
        const valor = String(aspasDuplas ?? aspasSimples ?? semAspas ?? '')
          .replace(/["<>]/g, '')
          .slice(0, MAX_ATRIBUTO);

        void inteiro;

        /*
         * `aria-label` nunca viaja com o valor, nem quando parece rótulo.
         *
         * A versão anterior mantinha o texto inteiro se ele CONTIVESSE uma
         * palavra de interface — e isso é um teste de substring, então
         * `aria-label="Maria: quero comprar, deixei like"` passava inteiro, com
         * nome e recado de espectador, direto para a nossa tabela.
         *
         * O que precisamos saber para escrever um seletor novo não é o texto: é
         * se o elemento SE ANUNCIA como campo de comentário ou botão de enviar.
         * Então guardamos só isso — a palavra-chave que casou, entre colchetes.
         * O diagnóstico continua inteiro e nenhum caractere digitado por gente
         * atravessa.
         */
        if (chave === 'aria-label') {
          const marca = ROTULO_DE_INTERFACE.exec(valor)?.[1]?.toLowerCase();
          return marca ? ` ${nome}="[rotulo:${marca}]"` : ` ${nome}=""`;
        }

        /*
         * `id` sai fora: no chat do TikTok ele carrega identificador de
         * mensagem e de perfil (`msg-<userId>`), que é dado de terceiro
         * disfarçado de detalhe técnico — e não ajuda em nada a montar seletor,
         * porque id gerado não se repete entre sessões.
         */
        if (chave === 'id') return ` ${nome}=""`;

        /*
         * De `data-*`, só `data-e2e`. É o atributo de teste do TikTok, o que a
         * cascata de seletores usa e o único que interessa; o resto é campo
         * livre onde a aplicação deles pode ter posto qualquer coisa, inclusive
         * id de usuário.
         */
        if (chave.startsWith('data-') && chave !== 'data-e2e') {
          return ` ${nome}=""`;
        }

        /*
         * Fora da allowlist, o atributo fica registrado mas vazio: saber que ele
         * existe ajuda a escrever o seletor, e o valor não é nosso para guardar.
         * O default é ESVAZIAR — atributo novo que o TikTok inventar amanhã não
         * entra no banco por omissão.
         */
        if (!ATRIBUTOS_COM_VALOR.has(chave)) return ` ${nome}=""`;

        // Da allowlist, sai normalizado (aspas duplas, valor cortado): formato
        // único é o que torna a amostra legível para quem vai montar o seletor.
        return ` ${nome}="${valor}"`;
      },
    )
    .replace(/\s+/g, ' ')
    .trim();

  return semTexto.slice(0, MAX_HTML_AMOSTRA);
}

/* -------------------------------------------------------------------------- *
 *  O serviço                                                                  *
 * -------------------------------------------------------------------------- */

@Injectable()
export class LiveConfigService {
  private readonly logger = new Logger(LiveConfigService.name);

  constructor(
    @InjectRepository(LiveSelectorFailure)
    private readonly falhas: Repository<LiveSelectorFailure>,
    @InjectRepository(AppUser)
    private readonly usuarios: Repository<AppUser>,
  ) {}

  /** A configuração que o app desktop busca antes de cada live. */
  configDeEnvio(): ConfigDeEnvio {
    const desligado = killSwitchLigado();
    return {
      version: numeroDoAmbiente('LIVE_ENVIO_VERSAO', VERSAO_DOS_SELETORES),
      killSwitch: desligado,
      seletores: {
        campo: listaDoAmbiente('LIVE_ENVIO_SELETORES_CAMPO', SELETORES_CAMPO),
        botaoEnviar: listaDoAmbiente(
          'LIVE_ENVIO_SELETORES_BOTAO',
          SELETORES_BOTAO_ENVIAR,
        ),
      },
      limites: {
        cooldownMs: numeroDoAmbiente('LIVE_ENVIO_COOLDOWN_MS', COOLDOWN_MS),
        maxPorMinuto: numeroDoAmbiente(
          'LIVE_ENVIO_MAX_POR_MINUTO',
          MAX_POR_MINUTO,
        ),
        maxCaracteres: numeroDoAmbiente(
          'LIVE_ENVIO_MAX_CARACTERES',
          MAX_CARACTERES,
        ),
        verificacaoMs: numeroDoAmbiente(
          'LIVE_ENVIO_VERIFICACAO_MS',
          VERIFICACAO_MS,
        ),
      },
      /*
       * A mensagem existe para o kill switch não parecer bug. Sem explicação na
       * tela, "o envio parou" é indistinguível de "o app quebrou", e o vendedor
       * vai reinstalar, reclamar e desconfiar do produto no meio da live dele.
       */
      mensagem:
        process.env.LIVE_ENVIO_MENSAGEM ??
        (desligado
          ? 'Envio automático pausado pelo PikPok. As respostas continuam aparecendo no painel para você copiar.'
          : undefined),
    };
  }

  /**
   * O app avisa que a cascata inteira falhou.
   *
   * Este é o sinal mais importante da fase: é ele que nos conta que o TikTok
   * mudou o HTML — de preferência antes de o suporte lotar. Cada linha traz a
   * versão da cascata que estava valendo, então dá para separar "ainda não
   * recebeu o seletor novo" de "o seletor novo também não serve".
   */
  async registrarFalhaDeSeletor(
    userId: string,
    dados: {
      runId?: string | null;
      version: number;
      html: string;
      userAgent?: string | null;
    },
  ): Promise<{ registrado: true }> {
    // A sanitização acontece ANTES de qualquer coisa — inclusive antes do log.
    // Um `logger.debug` com o HTML cru vazaria o chat para o agregador de logs,
    // que é o lugar de onde ninguém consegue apagar depois.
    const htmlSample = sanitizarHtml(dados.html);

    await this.falhas.save(
      this.falhas.create({
        userId,
        liveRunId: dados.runId ?? null,
        selectorsVersion: dados.version,
        htmlSample,
        userAgent: dados.userAgent?.slice(0, 300) ?? null,
      }),
    );

    this.logger.warn(
      `Cascata de seletores v${dados.version} falhou inteira para o usuário ${userId}. ` +
        'Se isto se repetir, o TikTok mudou o HTML e é preciso publicar seletor novo.',
    );
    return { registrado: true };
  }

  // ------------------------------------------------------------------- termo
  /** O termo e a versão que o app precisa mostrar antes de deixar ligar. */
  termoDeEnvioAutomatico(): { versao: string; texto: string } {
    return {
      versao: VERSAO_DO_TERMO_AUTO,
      texto: TERMO_DE_ENVIO_AUTOMATICO,
    };
  }

  /** O mesmo termo, já cruzado com o que este usuário aceitou. */
  async termoParaUsuario(userId: string) {
    const usuario = await this.usuarios.findOne({
      where: { id: userId },
      select: {
        id: true,
        liveAutoAcceptedAt: true,
        liveAutoAcceptedVersion: true,
      },
    });
    return {
      ...this.termoDeEnvioAutomatico(),
      aceito: this.aceiteVale(usuario ?? null),
      aceitoEm: usuario?.liveAutoAcceptedAt ?? null,
      versaoAceita: usuario?.liveAutoAcceptedVersion ?? null,
    };
  }

  /**
   * Grava o aceite com a VERSÃO do texto que foi mostrado.
   *
   * A versão é o que torna o registro auditável: um booleano só diria que
   * alguém clicou em algum aviso, algum dia. Com a versão, dá para provar qual
   * redação o vendedor leu — e, quando o termo mudar, saber exatamente quem
   * precisa ler de novo.
   */
  async aceitarEnvioAutomatico(
    userId: string,
    versao: string,
  ): Promise<{ aceitoEm: Date; versao: string }> {
    /*
     * A versão vem do cliente, mas quem manda é o servidor: aceitar uma string
     * arbitrária permitiria ao app registrar aceite de um termo que não existe
     * (ou de uma versão futura), e o registro deixaria de significar qualquer
     * coisa. Se o app mandar versão diferente da vigente, ele está com o texto
     * velho na tela — e aceitar o que ele NÃO leu é pior que recusar.
     */
    if (versao !== VERSAO_DO_TERMO_AUTO) {
      throw new ForbiddenException(
        'A versão do termo mudou. Atualize o app e leia o aviso novamente antes de aceitar.',
      );
    }

    const aceitoEm = new Date();
    await this.usuarios.update(
      { id: userId },
      {
        liveAutoAcceptedAt: aceitoEm,
        liveAutoAcceptedVersion: VERSAO_DO_TERMO_AUTO,
      },
    );
    this.logger.log(
      `Usuário ${userId} aceitou o termo de envio automático ${VERSAO_DO_TERMO_AUTO}.`,
    );
    return { aceitoEm, versao: VERSAO_DO_TERMO_AUTO };
  }

  /**
   * A TRAVA: sem aceite registrado, não abre run em modo `auto`.
   *
   * Isto não é enfeite jurídico. O aceite é a única coisa entre "o vendedor
   * escolheu correr o risco" e "o app começou a postar em nome dele porque uma
   * flag ficou ligada". Conferir no servidor, e não na tela, porque a tela é
   * do cliente: um app adulterado, uma versão antiga ou uma chamada direta à
   * API pulariam qualquer modal.
   *
   * O kill switch também barra aqui, e não só na configuração: se o app antigo
   * ignorar o `killSwitch` que recebeu, a run simplesmente não abre em `auto`.
   */
  async exigirAceiteParaAuto(userId: string): Promise<void> {
    if (killSwitchLigado()) {
      throw new ForbiddenException(
        'O envio automático está pausado pelo PikPok no momento. Use o modo painel: as respostas continuam aparecendo na sua tela.',
      );
    }

    const usuario = await this.usuarios.findOne({
      where: { id: userId },
      select: {
        id: true,
        liveAutoAcceptedAt: true,
        liveAutoAcceptedVersion: true,
      },
    });
    if (this.aceiteVale(usuario ?? null)) return;

    throw new ForbiddenException(
      'Para ligar o envio automático você precisa ler e aceitar o aviso de risco em POST /live/aceitar-envio-automatico.',
    );
  }

  /**
   * Aceite antigo não vale para termo novo — a regra é do motor
   * (`aceiteEstaVigente`), e aqui só se resolve o caso de a conta não existir.
   */
  private aceiteVale(usuario: AppUser | null): boolean {
    return !!usuario && aceiteEstaVigente(usuario);
  }
}
