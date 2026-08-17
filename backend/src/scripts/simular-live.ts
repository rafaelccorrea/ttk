import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AppModule } from '../app.module';
import { AiService, LoteDeRespostas } from '../modules/studio/ai.service';
import { LiveReplyService, MensagemDoChat } from '../modules/live/live-reply.service';
import { LiveFaq } from '../modules/live/entities/live-faq.entity';
import { LiveProduct } from '../modules/live/entities/live-product.entity';
import { LiveReply } from '../modules/live/entities/live-reply.entity';
import { LiveRun } from '../modules/live/entities/live-run.entity';
import { LiveSession } from '../modules/live/entities/live-session.entity';
import { LiveChatMessage } from '../modules/live/entities/live-chat-message.entity';
import { AppUser } from '../modules/users/entities/app-user.entity';
import { AiCostEvent } from '../modules/telemetry/entities/ai-cost-event.entity';

const log = new Logger('SimularLive');

/**
 * Uma live de vendas inteira, sintética, atravessando o motor de verdade —
 * `npm run simular:live`.
 *
 * POR QUE ISTO EXISTE, e não bastam os testes unitários: o motor é uma sequência
 * de decisões que só erram JUNTAS. O dedup depende do índice de trigrama, que
 * depende do texto normalizado; a decisão depende da confiança, que depende do
 * que o modelo devolveu; a cobrança depende do relógio. Cada peça passa isolada
 * e o conjunto ainda pode publicar um preço errado. Esta simulação é o lugar em
 * que essa costura aparece.
 *
 * O QUE É REAL: o Postgres, os repositórios, o `LiveReplyService` inteiro, o
 * dedup por trigrama, a decisão, a substituição de preço, o truncamento, a
 * cobrança de minuto e o registro de custo.
 *
 * O QUE É DUBLADO, e por quê: só o `AiService`. Chamar o Claude de verdade aqui
 * custaria dinheiro a cada execução e — pior — tornaria o resultado não
 * determinístico, o que mataria a utilidade de uma simulação que precisa poder
 * ser rodada mil vezes procurando regressão. O dublê devolve de propósito os
 * casos RUINS que o motor tem de barrar: resposta sem fonte, com preço literal,
 * com marcador de id que não existe, e na faixa cinzenta de confiança.
 *
 * Tudo que é criado aqui é apagado no fim, inclusive quando algo falha. Nenhum
 * dado de usuário real é tocado: a simulação cria a própria conta.
 */

const EMAIL_DA_SIMULACAO = 'simulacao-live@pikpok.local';

/** Um caso do roteiro: o que entra no chat e o que TEM de acontecer. */
interface Cena {
  nome: string;
  mensagens: MensagemDoChat[];
  esperado: string;
  conferir: (r: {
    respostas: LiveReply[];
    escaladas: LiveChatMessage[];
  }) => string | null;
}

let sequencia = 0;
function msg(text: string, autor = 'espectador-1', quando = new Date()): MensagemDoChat {
  sequencia += 1;
  return {
    externalMessageId: `sim-${sequencia}`,
    authorHash: `hash-${autor}`,
    text,
    receivedAt: quando,
  };
}

/**
 * O dublê do modelo.
 *
 * Ele decide pelo TEXTO da pergunta, para que cada cena do roteiro consiga
 * exercitar um caminho específico do motor sem depender de sorte.
 */
function dubleDoModelo(): Partial<AiService> {
  return {
    get enabled() {
      return true;
    },
    async responderChatDaLive(entrada): Promise<LoteDeRespostas> {
      return {
        model: entrada.modelo,
        cacheReadTokens: 0,
        respostas: entrada.perguntas.map((p) => {
          const t = p.texto.toLowerCase();

          // Pergunta sobre produto que não está na base: o modelo "sabe" que não
          // sabe. Sem fonte, a âncora tem de barrar.
          if (t.includes('geladeira')) {
            return { messageId: p.messageId, text: 'Temos sim, sai baratinho!', confidence: 0.95, productIds: [] };
          }
          // O modelo tentando escrever preço por conta própria — proibido.
          if (t.includes('quanto custa o kit')) {
            return { messageId: p.messageId, text: 'O kit sai por R$ 89,90 hoje!', confidence: 0.93, productIds: ['#PRODUTO#'] };
          }
          // Marcador com id inexistente.
          if (t.includes('fone')) {
            return { messageId: p.messageId, text: 'O fone sai por {{PRECO:id-que-nao-existe}}!', confidence: 0.9, productIds: ['#PRODUTO#'] };
          }
          // Faixa cinzenta em pergunta de alto valor → reprocessa no modelo caro.
          if (t.includes('cabe em mim')) {
            return { messageId: p.messageId, text: 'Acho que sim, o tamanho é padrão.', confidence: 0.62, productIds: ['#PRODUTO#'] };
          }
          // O caminho bom: marcador de preço, com fonte.
          return {
            messageId: p.messageId,
            text: 'Sai por {{PRECO:#PRODUTO#}} com frete grátis acima de R$ 99!',
            confidence: 0.91,
            productIds: ['#PRODUTO#'],
          };
        }),
      };
    },
  };
}

async function run(): Promise<void> {
  const app = await NestFactory.createApplicationContext(AppModule, {
    // 'log' incluído: o relatório da simulação sai por aqui, e uma simulação
    // que não imprime o que mediu não serve para nada.
    logger: ['error', 'warn', 'log'],
  });

  const users = app.get<Repository<AppUser>>(getRepositoryToken(AppUser));
  const sessoes = app.get<Repository<LiveSession>>(getRepositoryToken(LiveSession));
  const produtos = app.get<Repository<LiveProduct>>(getRepositoryToken(LiveProduct));
  const faqs = app.get<Repository<LiveFaq>>(getRepositoryToken(LiveFaq));
  const runs = app.get<Repository<LiveRun>>(getRepositoryToken(LiveRun));
  const mensagens = app.get<Repository<LiveChatMessage>>(getRepositoryToken(LiveChatMessage));
  const respostasRepo = app.get<Repository<LiveReply>>(getRepositoryToken(LiveReply));
  const custos = app.get<Repository<AiCostEvent>>(getRepositoryToken(AiCostEvent));
  const motor = app.get(LiveReplyService);

  // O dublê entra por cima da instância já injetada: é o mesmo objeto que o
  // motor guardou, então trocar o método aqui troca para ele também.
  const ai = app.get(AiService);
  const dublê = dubleDoModelo();
  (ai as unknown as Record<string, unknown>).responderChatDaLive =
    dublê.responderChatDaLive!.bind(dublê);

  let userId = '';
  let sessionId = '';
  const problemas: string[] = [];

  try {
    /* ---------------------------------------------------- a conta e a base */
    await users.delete({ email: EMAIL_DA_SIMULACAO });
    const conta = await users.save(
      users.create({
        // O id de app_users NÃO é gerado pelo banco: em produção ele é o `sub`
        // do Supabase Auth. A simulação precisa cunhar o próprio.
        id: randomUUID(),
        email: EMAIL_DA_SIMULACAO,
        plan: 'business',
        credits: 10_000,
        liveMinutes: 3,
      }),
    );
    userId = conta.id;
    log.log(`Conta de simulação ${userId} criada com 3 minutos de saldo.`);

    const sessao = await sessoes.save(
      sessoes.create({
        userId,
        title: 'Live simulada',
        status: 'pronta',
        sourceKind: 'manual',
      }),
    );
    sessionId = sessao.id;

    // Um produto CARO de propósito: quatro dígitos é a faixa em que a proteção
    // de preço já esteve inerte, e a simulação precisa passar por ela.
    const caro = await produtos.save(
      produtos.create({
        liveSessionId: sessionId,
        userId,
        name: 'Kit completo de maquiagem profissional edição limitada',
        priceBrl: '1499.90',
        variants: ['rosa', 'nude'],
        aliases: ['kit completo', 'kit grande'],
        /*
         * O frete é cadastrado COM valor de propósito: é ele que autoriza a
         * resposta a dizer "frete grátis acima de R$ 99" sem ser acusada de
         * inventar preço. Sem esta linha a simulação nunca exercita o caminho
         * feliz — tudo escala, e o relatório sai com zero respostas prontas
         * parecendo saúde quando na verdade é o produto não respondendo nada.
         */
        shippingInfo: 'Frete grátis acima de R$ 99 para todo o Brasil',
        origin: 'manual',
        active: true,
      }),
    );
    await faqs.save(
      faqs.create({
        liveSessionId: sessionId,
        userId,
        question: 'Qual o prazo de entrega?',
        answer: 'De 5 a 10 dias úteis para todo o Brasil.',
        kind: 'faq',
        origin: 'manual',
      }),
    );

    /* --------------------------------------------------------- a live roda */
    const liveRun = await motor.abrirRun(userId, {
      knowledgeSessionId: sessionId,
      tiktokUsername: 'loja_simulada',
    });
    log.log(`Run ${liveRun.id} aberta.`);

    const comProduto = (texto: string) => texto.replace('#PRODUTO#', caro.id);
    // O dublê devolve '#PRODUTO#' como placeholder; troca pelo id real agora que
    // ele existe.
    const original = ai.responderChatDaLive.bind(ai);
    (ai as unknown as Record<string, unknown>).responderChatDaLive = async (
      entrada: Parameters<AiService['responderChatDaLive']>[0],
    ) => {
      const lote = await original(entrada);
      return {
        ...lote,
        respostas: lote.respostas.map((r) => ({
          ...r,
          text: comProduto(r.text),
          productIds: r.productIds.map(comProduto),
        })),
      };
    };

    const agora = Date.now();
    const cenas: Cena[] = [
      {
        nome: 'ruído puro não gera resposta nem custo',
        mensagens: ['kkkkk', '❤️❤️', 'top demais', 'primeira', '😂'].map((t, i) =>
          msg(t, `ruido-${i}`, new Date(agora)),
        ),
        esperado: 'nenhuma resposta, nenhuma escalada',
        conferir: (r) =>
          r.respostas.length === 0 && r.escaladas.length === 0
            ? null
            : `gerou ${r.respostas.length} resposta(s) para ruído`,
      },
      {
        nome: 'rajada com a mesma pergunta escrita de formas diferentes',
        mensagens: [
          'quanto custa o kit completo?',
          'qnt custa o kit completo',
          'quanto custa o kit completoo?',
          'quanto custa o kit completo ?',
        ].map((t, i) => msg(t, `rajada-${i}`, new Date(agora + 1000))),
        esperado: 'uma resposta só; as demais viram duplicadas',
        conferir: (r) =>
          r.respostas.length <= 1
            ? null
            : `dedup falhou: ${r.respostas.length} respostas para a mesma pergunta`,
      },
      {
        nome: 'preço de quatro dígitos sai inteiro ou não sai',
        mensagens: [msg('qual o valor do kit grande?', 'preco-1', new Date(agora + 2000))],
        esperado: 'preço completo (R$ 1.499,90) ou escalação — nunca valor partido',
        conferir: (r) => {
          const enviaveis = r.respostas.filter((x) => x.decision === 'enviar');
          for (const resposta of enviaveis) {
            if (/R\$\s*$/.test(resposta.text)) return `resposta com "R$" órfão: "${resposta.text}"`;
            if (/R\$\s*1\.?4(?!99,90)/.test(resposta.text)) {
              return `preço partido: "${resposta.text}"`;
            }
            if (resposta.text.includes('{{')) return `marcador não resolvido: "${resposta.text}"`;
          }
          return null;
        },
      },
      {
        /*
         * A cena mais importante do roteiro, e a última a ser escrita — porque
         * até ela existir a simulação passava com o motor ESCALANDO TUDO, o que
         * é o retrato de um produto que não responde nada. Uma bateria que só
         * verifica o que deve ser barrado dá nota máxima para um copiloto mudo.
         */
        nome: 'pergunta boa vira resposta PRONTA, com preço e frete da base',
        mensagens: [
          msg('o kit completo tem em nude?', 'feliz-1', new Date(agora + 2500)),
        ],
        esperado: 'decisão enviar, com o preço da base e sem valor inventado',
        conferir: (r) => {
          const prontas = r.respostas.filter((x) => x.decision === 'enviar');
          if (!prontas.length) {
            return 'nenhuma resposta chegou a "enviar" — o copiloto está mudo';
          }
          const texto = prontas[0].text;
          if (!/R\$\s*1\.499,90/.test(texto)) {
            return `preço da base não saiu inteiro: "${texto}"`;
          }
          if (!prontas[0].sourceProductIds?.length) {
            return 'resposta pronta sem fonte citada';
          }
          return null;
        },
      },
      {
        nome: 'produto fora da base não pode virar resposta pronta',
        mensagens: [msg('vende geladeira também?', 'fora-1', new Date(agora + 3000))],
        esperado: 'escalação — confiança alta sem fonte não envia',
        conferir: (r) =>
          r.respostas.some((x) => x.decision === 'enviar')
            ? 'respondeu como pronta sobre produto que não existe na base'
            : null,
      },
      {
        nome: 'preço escrito pelo modelo é barrado',
        mensagens: [msg('quanto custa o kit?', 'literal-1', new Date(agora + 4000))],
        esperado: 'escalação — preço nunca vem do modelo',
        conferir: (r) =>
          r.respostas.some((x) => x.decision === 'enviar' && /R\$/.test(x.text))
            ? 'publicou preço escrito pelo modelo'
            : null,
      },
      {
        nome: 'marcador com id inexistente é barrado',
        mensagens: [msg('e o fone, quanto sai?', 'fone-1', new Date(agora + 5000))],
        esperado: 'escalação',
        conferir: (r) =>
          r.respostas.some((x) => x.decision === 'enviar' && x.text.includes('{{'))
            ? 'publicou marcador não resolvido'
            : null,
      },
      {
        nome: 'assunto da lista negra escala mesmo com confiança alta',
        mensagens: [msg('como faço para pedir reembolso?', 'negra-1', new Date(agora + 6000))],
        esperado: 'escalação sempre',
        conferir: (r) =>
          r.respostas.some((x) => x.decision === 'enviar')
            ? 'respondeu sozinho sobre reembolso'
            : null,
      },
      {
        nome: 'link e menção nunca viram resposta pronta',
        mensagens: [
          msg('vi em https://outraloja.com/kit, é o mesmo?', 'link-1', new Date(agora + 7000)),
          msg('@loja_simulada me chama', 'mencao-1', new Date(agora + 7500)),
        ],
        esperado: 'nada pronto com link ou menção',
        conferir: (r) =>
          r.respostas.some(
            (x) => x.decision === 'enviar' && /https?:|www\.|(^|\s)@\w/.test(x.text),
          )
            ? 'resposta pronta com link ou menção'
            : null,
      },
    ];

    let vistas = 0;
    for (const cena of cenas) {
      const resultado = await motor.processarLote(liveRun.id, userId, cena.mensagens);
      vistas += cena.mensagens.length;
      const falha = cena.conferir(resultado);
      const marca = falha ? 'FALHOU' : 'ok';
      log.log(
        `[${marca}] ${cena.nome} — respostas: ${resultado.respostas.length}, escaladas: ${resultado.escaladas.length}`,
      );
      if (falha) {
        problemas.push(`${cena.nome}: ${falha}`);
        /*
         * O detalhe por mensagem só é impresso quando a cena falha, e é ele que
         * transforma "o dedup errou" em algo diagnosticável: sem ver o status e
         * o cluster de cada uma, não há como saber se o problema foi semelhança
         * abaixo do limiar, cluster fragmentado ou pergunta não reconhecida.
         */
        const ids = cena.mensagens.map((m) => m.externalMessageId);
        const gravadasDaCena = await mensagens.find({
          where: { liveRunId: liveRun.id },
          order: { receivedAt: 'ASC' },
        });
        for (const g of gravadasDaCena.filter((x) =>
          ids.includes(x.externalMessageId),
        )) {
          log.warn(
            `    · "${g.text}" → status=${g.status} pergunta=${g.isQuestion} cluster=${(g.clusterKey ?? '-').slice(0, 8)} repeticoes=${g.repeatCount}`,
          );
        }
      }
    }

    /* ------------------------------------------------- repetição vira sinal */
    const mesmaPergunta = 'o kit completo tem em rosa?';
    for (let i = 0; i < 5; i += 1) {
      await motor.processarLote(liveRun.id, userId, [
        msg(mesmaPergunta, `multidao-${i}`, new Date(agora + 8000 + i * 100)),
      ]);
      vistas += 1;
    }
    const escaladasPorRepeticao = await mensagens.count({
      where: { liveRunId: liveRun.id, status: 'escalada' },
    });
    log.log(`Mensagens escaladas ao painel: ${escaladasPorRepeticao}`);

    /* --------------------------------------------------------- a cobrança */
    const antes = await runs.findOneBy({ id: liveRun.id });
    await motor.cobrarMinuto(liveRun.id);
    await motor.cobrarMinuto(liveRun.id); // batimento repetido no mesmo minuto
    const depois = await runs.findOneBy({ id: liveRun.id });
    const cobrados = (depois?.minutesCharged ?? 0) - (antes?.minutesCharged ?? 0);
    log.log(`Minutos cobrados por dois batimentos no mesmo minuto: ${cobrados}`);
    if (cobrados !== 1) {
      problemas.push(`dois batimentos no mesmo minuto cobraram ${cobrados} minuto(s)`);
    }

    /* ---------------------------------------------------- o saldo acabando */
    const contaAgora = await users.findOneBy({ id: userId });
    log.log(`Saldo restante: ${contaAgora?.liveMinutes} minuto(s)`);

    /* ---------------------------------------------------------- relatório */
    const todas = await respostasRepo.find({ where: { liveRunId: liveRun.id } });
    const porDecisao = todas.reduce<Record<string, number>>((acc, r) => {
      acc[r.decision] = (acc[r.decision] ?? 0) + 1;
      return acc;
    }, {});
    const latencias = todas.map((r) => r.latencyMs).sort((a, b) => a - b);
    const p = (q: number) => latencias[Math.floor(latencias.length * q)] ?? 0;
    const eventos = await custos.find({ where: { userId, feature: 'live_reply' } });
    const custoTotal = eventos.reduce((s, e) => s + Number(e.costBrl), 0);
    const duplicadas = await mensagens.count({
      where: { liveRunId: liveRun.id, status: 'duplicada' },
    });
    const ignoradas = await mensagens.count({
      where: { liveRunId: liveRun.id, status: 'ignorada' },
    });

    log.log('');
    log.log('=========== RELATÓRIO DA LIVE SIMULADA ===========');
    log.log(`mensagens no chat .......... ${vistas}`);
    log.log(`ignoradas (ruído) .......... ${ignoradas}`);
    log.log(`duplicadas (dedup) ......... ${duplicadas}`);
    log.log(`escaladas ao painel ........ ${escaladasPorRepeticao}`);
    log.log(`respostas por decisão ...... ${JSON.stringify(porDecisao)}`);
    log.log(`latência p50 / p95 ......... ${p(0.5)}ms / ${p(0.95)}ms`);
    log.log(`eventos de custo ........... ${eventos.length}`);
    log.log(`custo registrado ........... R$ ${custoTotal.toFixed(4)}`);
    log.log('==================================================');
    log.log('');

    if (problemas.length) {
      log.error(`${problemas.length} PROBLEMA(S) ENCONTRADO(S):`);
      problemas.forEach((p, i) => log.error(`  ${i + 1}. ${p}`));
    } else {
      log.log('Nenhum desvio: todas as regras duras se mantiveram.');
    }
  } finally {
    /*
     * A limpeza roda sempre, inclusive quando a simulação falha no meio: dado de
     * simulação sobrando num banco de produção é pior que a falha em si, porque
     * aparece depois em relatório como se fosse uso real.
     */
    /*
     * A ORDEM importa: `FK_live_runs_session` é RESTRICT de propósito — apagar a
     * base de conhecimento não pode levar o histórico do que foi respondido ao
     * vivo. Então a run sai primeiro, e a sessão depois. (Esta ordem inversa foi
     * o primeiro achado da simulação: ela falhou na limpeza, o que é a FK
     * fazendo exatamente o trabalho dela.)
     */
    if (userId) {
      await runs.delete({ userId });
      await custos.delete({ userId });
    }
    if (sessionId) await sessoes.delete({ id: sessionId });
    if (userId) await users.delete({ id: userId });
    await app.close();
    log.log('Dados da simulação removidos.');
  }

  if (problemas.length) process.exitCode = 1;
}

run().catch((e) => {
  log.error(e instanceof Error ? e.stack : String(e));
  process.exit(1);
});
