import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AppModule } from '../app.module';
import { LiveFaq, LiveFaqKind } from '../modules/live/entities/live-faq.entity';
import { LiveProduct } from '../modules/live/entities/live-product.entity';
import { LiveSession } from '../modules/live/entities/live-session.entity';
import { LiveReplyService } from '../modules/live/live-reply.service';

/**
 * A base de conhecimento da LIVE DE APRESENTAÇÃO DO PIKPOK — a live gravada
 * que roda em loop vendendo o próprio sistema.
 *
 *   npx ts-node src/scripts/montar-base-apresentacao.ts <sessionId>
 *
 * Por que à mão: a extração automática procura produto físico com preço na
 * fala, e esta live vende um SaaS — voltou vazia. Aqui os "produtos" são os
 * planos (preço = billing.config) e a FAQ é o que o público pergunta numa
 * apresentação. Idempotente: apaga e regrava só o que tem origem 'manual'
 * desta sessão, e marca a sessão como pronta.
 */
type P = Partial<LiveProduct> & { name: string };
type F = { q: string; a: string; kind?: LiveFaqKind; produto?: string };

const DIGITAL = 'Produto digital: acesso imediato após o pagamento, sem frete.';

const PRODUTOS: P[] = [
  {
    name: 'Plano Essencial',
    priceBrl: '39.90',
    aliases: ['essencial', 'plano básico', 'plano de 39', '39,90', 'plano mais barato'],
    details:
      'Mensal: 450 créditos de IA por mês. Anual: R$ 399,90 com 4.600 créditos. Vem com 15 horas de live na adesão (uma vez, não mensal). Inclui descoberta completa (produtos, vídeos e criadores que mais vendem), roteiros e análises com IA, transcrição de vídeos, imagens com IA e o Live Copilot no modo painel.',
    shippingInfo: DIGITAL,
  },
  {
    name: 'Plano Pro',
    priceBrl: '89.90',
    aliases: ['pro', 'plano pró', 'plano de 89', '89,90', 'plano do meio', 'plano recomendado'],
    details:
      'Mensal: 1.000 créditos de IA por mês. Anual: R$ 899,90 com 10.400 créditos. Vem com 40 horas de live na adesão (uma vez, não mensal). Tudo do Essencial mais vídeos com IA (Fábrica de criativos com apresentador), Multiplicador de conteúdo e Cortes automáticos de vídeo longo. Teto de 6 horas por live.',
    promo:
      'Oferta da live: quem assinar o Pro de R$ 89,90 e chamar no direct do TikTok com o código "mestre" ganha o dobro — 2.000 créditos e 80 horas de live.',
    shippingInfo: DIGITAL,
  },
  {
    name: 'Plano Business',
    priceBrl: '249.90',
    aliases: ['business', 'plano top', 'plano de 249', '249,90', 'plano completo', 'plano empresa'],
    details:
      'Mensal: 2.800 créditos de IA por mês. Anual: R$ 2.499,90 com 28.800 créditos. Vem com 60 horas de live na adesão (uma vez, não mensal). Tudo do Pro mais envio automático (a IA responde sozinha no chat da live — exclusivo), coleta de dados automatizada, onboarding dedicado e suporte prioritário. Teto de 24 horas por live.',
    shippingInfo: DIGITAL,
  },
  {
    name: 'Pacotes extras de créditos',
    priceBrl: null,
    aliases: ['créditos extras', 'recarga', 'comprar créditos', 'pacote de créditos', 'tokens'],
    details:
      'Para quem acabou os créditos do mês: 100 créditos por R$ 14,90; 300 créditos por R$ 39,90; 1.000 créditos por R$ 119,90. Crédito de IA não vira hora de live nem o contrário.',
  },
  {
    name: 'Horas de live avulsas',
    priceBrl: null,
    aliases: ['hora de live', 'horas extras de live', 'comprar hora', 'minutos de live'],
    details:
      'Add-on para qualquer plano: 1 hora por R$ 9,90; 5 horas por R$ 39,90; 15 horas por R$ 99,90; 40 horas por R$ 219,90. Hora de live não expira.',
  },
];

const FAQ: F[] = [
  // ---- o que é
  { q: 'O que é o PikPok?', a: 'É um sistema pra você vender mais no TikTok Shop: mostra os produtos, vídeos e criadores que mais vendem, cria roteiros, vídeos com IA, cortes, e o Copiloto responde o chat da sua live.' },
  { q: 'Essa live é gravada? Tem alguém aí?', a: 'Sim, a live é gravada e roda em loop — e quem está te respondendo agora é o Copiloto do PikPok, exatamente o que você pode ter na sua live.' },
  { q: 'O que é o Copiloto / carro-chefe?', a: 'O Copiloto lê o chat da sua live e responde seus clientes com base no que você cadastrou. Você grava a live uma vez, deixa em loop e a IA vende por você.' },
  { q: 'Como o copiloto sabe responder sobre meu produto?', a: 'Você sobe a gravação da sua live: a plataforma transcreve, entende preço, variação e frete e monta a base. Depois você revisa e ensina o que faltar.' },
  { q: 'A IA sabe tudo do meu produto?', a: 'Não — e ninguém sabe 100%. Você ensina os pontos que importam (preço, variações, frete, promoção) e ela responde a partir disso, sem inventar.' },
  { q: 'A IA pode inventar um preço errado?', a: 'Não. O preço sempre vem do que você cadastrou; a IA nunca cria valor por conta própria. Se não sabe, ela avisa você pra responder.' },
  { q: 'A IA responde sozinha no chat ou eu preciso copiar?', a: 'Nos dois jeitos: no modo painel a resposta aparece pra você copiar ou falar; no Business o envio automático manda direto no chat.' },
  { q: 'É seguro? Não corre risco de banir a conta no TikTok?', a: 'No modo painel não toca no chat, risco zero. O envio automático é opcional, só no Business, com aceite de termo e cadência humana (nunca dispara em massa).' },
  { q: 'Preciso instalar alguma coisa?', a: 'A base e o Estúdio são no site. Pra rodar o Copiloto na live você usa nosso app de computador (Windows), que conecta ao chat da sua transmissão.' },
  { q: 'Funciona pelo celular?', a: 'O site funciona no celular. O Copiloto ao vivo roda no computador, porque é ele que acompanha o chat da live.' },
  { q: 'Como deixo a live em loop?', a: 'Você grava a live uma vez, monta a base a partir dela e transmite a gravação em loop pelo tempo que quiser — o Copiloto responde enquanto ela roda.' },
  // ---- estúdio
  { q: 'O que são os cortes?', a: 'Você sobe um vídeo longo e a IA transcreve e faz vários cortes prontos pra postar. Acabou ficar editando um monte de vídeo.' },
  { q: 'O que é o multiplicador de vídeo?', a: 'Você coloca um vídeo e ele gera dezenas de variações com gancho, corpo e CTA. Simples, direto, sem fórmula mágica.' },
  { q: 'O que é a análise de vídeo?', a: 'Você sobe ou cola um vídeo que vende, a IA transcreve, analisa e gera um roteiro adaptado ao seu produto.' },
  { q: 'O que é a fábrica de criativos?', a: 'Você cadastra o produto com fotos, cria um apresentador com IA e ela gera o vídeo cena a cena, com fala sincronizada, e junta tudo num vídeo só.' },
  { q: 'Preciso aparecer nos vídeos?', a: 'Não. Você cria um apresentador com IA (como o Kiko da demonstração) e ele apresenta seu produto por você.' },
  { q: 'Por que demora pra gerar o vídeo?', a: 'É IA gerando vídeo de verdade, não um template. Leva alguns minutos por cena — você pode fazer outra coisa e voltar.' },
  { q: 'Posso refazer uma cena se não gostar?', a: 'Pode. Cada cena pode ser regerada, e no fim a plataforma junta as cenas num vídeo só pra você baixar e postar.' },
  { q: 'De onde vêm os produtos mais vendidos? É inventado?', a: 'Não é inventado: vem de uma empresa especializada que fornece esses dados por API. São os mais vendidos do mês, por categoria, com faturamento e preço médio.' },
  { q: 'Dá pra ver os criadores e vídeos que mais vendem?', a: 'Sim. Além dos produtos, você vê os vídeos que realmente venderam e os criadores por trás deles — e gera roteiro em cima.' },
  // ---- preço
  { q: 'Quanto custa? Quais são os planos?', a: 'Essencial R$ 39,90 (450 créditos), Pro R$ 89,90 (1.000 créditos) e Business R$ 249,90 (2.800 créditos). Todos já vêm com horas de live.', produto: 'Plano Pro' },
  { q: 'Qual a oferta da live? Como uso o código mestre?', a: 'Assina o Pro de R$ 89,90, chama no direct do TikTok e fala "mestre, vi o vídeo na live": a gente dobra pra 2.000 créditos e 80 horas de live.', produto: 'Plano Pro' },
  { q: 'Quantas horas de live vêm em cada plano?', a: 'Essencial 15 h, Pro 40 h e Business 60 h — creditadas uma vez na adesão. Hora de live não expira.' },
  { q: 'As horas de live renovam todo mês?', a: 'Não, são um bônus único da adesão. Quando acabar, tem hora avulsa a partir de R$ 9,90 a hora.', produto: 'Horas de live avulsas' },
  { q: 'O que é crédito? O que gasta crédito?', a: 'Crédito é a moeda das gerações: roteiro 8, análise 12, imagem 12, vídeo com IA 60 por cena, corte 2 ou 6, transcrição 6 a cada 10 min. A live gasta horas, não créditos.' },
  { q: 'Crédito vira hora de live?', a: 'Não, são separados de propósito: sua live nunca consome os créditos que você guardou pra criar vídeos.' },
  { q: 'Tem plano anual? Tem desconto?', a: 'Tem: Essencial R$ 399,90/ano (4.600 créditos), Pro R$ 899,90/ano (10.400) e Business R$ 2.499,90/ano (28.800) — dois meses grátis.' },
  { q: 'Tem plano grátis ou teste?', a: 'Hoje não tem teste grátis: o acesso começa pelo Essencial de R$ 39,90, que já vem com 15 horas de live pra você testar o Copiloto de verdade.', produto: 'Plano Essencial' },
  { q: 'Qual a diferença do Pro pro Business?', a: 'O Business tem 2.800 créditos, 60 h de live, envio automático no chat, coleta de dados automatizada, onboarding dedicado e suporte prioritário.', produto: 'Plano Business' },
  { q: 'Como faço pra assinar / começar?', a: 'Entra em pikpokviral.com.br, cria a conta e escolhe o plano — o pagamento é pela Stripe e o acesso é na hora. Quer a oferta? Chama no direct com o código "mestre".' },
  { q: 'Como pago? Aceita Pix ou cartão?', a: 'Pagamento pela Stripe, com cartão. Assinatura mensal ou anual, cancela quando quiser.' },
  { q: 'Posso cancelar quando quiser?', a: 'Pode, sem fidelidade. Cancela pelo painel e o acesso vale até o fim do período pago.' },
  { q: 'Serve pra Shopee ou só TikTok Shop?', a: 'O foco hoje é TikTok Shop — os dados de produtos e criadores são de lá. O Estúdio (roteiros, vídeos, cortes) serve pra qualquer plataforma.' },
  { q: 'Tem suporte? Tem ajuda pra configurar?', a: 'Tem suporte pelo chat dentro do sistema em todos os planos; o Business tem onboarding dedicado e suporte prioritário.' },
  // ---- objeções
  { q: 'Tá caro.', a: 'Pensa no que custa uma hora sua ao vivo: por R$ 89,90 você tem 40 horas de live respondida e 1.000 créditos de vídeo. Uma venda paga o mês.', kind: 'objecao', produto: 'Plano Pro' },
  { q: 'E se a IA responder errado?', a: 'Ela só responde o que você cadastrou, nunca inventa preço, e o que ela não sabe vai pro seu painel pra você responder. Você continua no controle.', kind: 'objecao' },
  { q: 'Não sei mexer com isso, é complicado?', a: 'É subir a gravação da live, revisar a lista que a IA montou e ligar o app. Se travar, o suporte te acompanha.', kind: 'objecao' },
  { q: 'Isso é golpe? É real?', a: 'É real — você está vendo o sistema rodando agora: esta resposta foi o Copiloto que escreveu. Site: pikpokviral.com.br.', kind: 'objecao' },
  { q: 'Política de reembolso', a: 'Assinatura sem fidelidade: cancela quando quiser e mantém o acesso até o fim do período. Dúvida sobre cobrança, fala com o suporte no chat do sistema.', kind: 'politica' },
];

async function main() {
  const sessionId = process.argv[2];
  if (!sessionId) {
    console.error('Uso: npx ts-node src/scripts/montar-base-apresentacao.ts <sessionId>');
    process.exit(1);
  }
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
  try {
    const sessoes: Repository<LiveSession> = app.get(getRepositoryToken(LiveSession));
    const produtos: Repository<LiveProduct> = app.get(getRepositoryToken(LiveProduct));
    const faqs: Repository<LiveFaq> = app.get(getRepositoryToken(LiveFaq));
    const sessao = await sessoes.findOneByOrFail({ id: sessionId });
    const userId = sessao.userId;

    await faqs.delete({ liveSessionId: sessionId, origin: 'manual' });
    await produtos.delete({ liveSessionId: sessionId, origin: 'manual' });

    const salvos = await produtos.save(
      PRODUTOS.map((p) =>
        produtos.create({
          userId,
          liveSessionId: sessionId,
          name: p.name,
          priceBrl: p.priceBrl ?? null,
          variants: [],
          shippingInfo: p.shippingInfo ?? null,
          promo: p.promo ?? null,
          details: p.details ?? null,
          aliases: p.aliases ?? [],
          confidence: '1.00',
          origin: 'manual',
          active: true,
        }),
      ),
    );
    const porNome = new Map(salvos.map((p) => [p.name, p.id]));

    await faqs.save(
      FAQ.map((f, i) =>
        faqs.create({
          userId,
          liveSessionId: sessionId,
          liveProductId: f.produto ? (porNome.get(f.produto) ?? null) : null,
          question: f.q,
          answer: f.a,
          kind: f.kind ?? 'faq',
          origin: 'manual',
          priority: FAQ.length - i,
        }),
      ),
    );

    await sessoes.update(
      { id: sessionId },
      {
        status: 'pronta',
        errorMessage: null,
        processingStartedAt: null,
        pendingExtractCharge: false,
        pendingTranscribeBlocks: 0,
      },
    );
    app.get(LiveReplyService).invalidarBasesDaSessao(sessionId);
    console.log(
      `Base montada na sessão ${sessionId}: ${salvos.length} produtos, ${FAQ.length} FAQ. Status: pronta.`,
    );
  } finally {
    await app.close();
  }
}

void main().catch((e) => {
  console.error(e instanceof Error ? e.stack : String(e));
  process.exitCode = 1;
});
