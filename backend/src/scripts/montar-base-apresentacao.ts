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
 * fala, e esta live vende um SaaS — voltou vazia.
 *
 * Como está organizada: cada MÓDULO do sistema é um "produto" (Copiloto,
 * Descoberta, Estúdio, Fábrica, Multiplicador, Cortes, conta/pagamento), além
 * dos planos e pacotes com preço. TODA pergunta da FAQ está amarrada a um
 * produto: a regra "resposta pronta exige fonte citada" escala para o painel o
 * que o modelo responde sem `productIds`, e com a FAQ solta era exatamente o
 * que acontecia com "isso é live gravada?" — 0,99 de confiança e mesmo assim
 * "precisa de você". Amarrada ao módulo, o modelo cita a fonte e a resposta
 * sai pronta.
 *
 * Idempotente: apaga e regrava só o que tem origem 'manual' desta sessão, e
 * marca a sessão como pronta. Preços saem de `billing.config.ts`; se mudarem
 * lá, mudam aqui também.
 */
type P = Partial<LiveProduct> & { name: string };
type F = { q: string; a: string; kind?: LiveFaqKind; produto: string };

const DIGITAL = 'Produto digital: acesso imediato após o pagamento, sem frete.';

const PRODUTOS: P[] = [
  // ------------------------------------------------------------- planos
  {
    name: 'Plano Essencial',
    priceBrl: '39.90',
    aliases: ['essencial', 'plano básico', 'plano de 39', '39,90', 'plano mais barato', 'plano inicial'],
    details:
      'Mensal R$ 39,90: 450 créditos de IA por mês. Anual R$ 399,90: 4.600 créditos (equivale a 2 meses grátis). Vem com 15 horas de live creditadas uma vez na adesão (não é mensal). Inclui Descoberta completa (produtos, vídeos e criadores que mais vendem), roteiros e análises com IA, transcrição de vídeos, imagens com IA e o Live Copilot no modo painel. Não inclui vídeo com IA, Multiplicador nem Cortes (esses são do Pro).',
    shippingInfo: DIGITAL,
  },
  {
    name: 'Plano Pro',
    priceBrl: '89.90',
    aliases: ['pro', 'plano pró', 'plano de 89', '89,90', 'plano do meio', 'plano recomendado', 'plano da oferta'],
    details:
      'Mensal R$ 89,90: 1.000 créditos de IA por mês. Anual R$ 899,90: 10.400 créditos. Vem com 40 horas de live creditadas uma vez na adesão. Tudo do Essencial mais vídeos com IA (Fábrica de criativos com apresentador), Multiplicador de conteúdo e Cortes automáticos de vídeo longo. Teto de 6 horas por live. É o plano mais escolhido.',
    promo:
      'OFERTA DA LIVE: quem assinar o Pro de R$ 89,90 e chamar no direct do TikTok com o código "mestre" ("mestre, vi o vídeo na live") ganha o dobro — 2.000 créditos e 80 horas de live. Vale só pra quem está assistindo esta live.',
    shippingInfo: DIGITAL,
  },
  {
    name: 'Plano Business',
    priceBrl: '249.90',
    aliases: ['business', 'plano top', 'plano de 249', '249,90', 'plano completo', 'plano empresa', 'plano avançado'],
    details:
      'Mensal R$ 249,90: 2.800 créditos de IA por mês. Anual R$ 2.499,90: 28.800 créditos. Vem com 60 horas de live creditadas uma vez na adesão. Tudo do Pro mais ENVIO AUTOMÁTICO (a IA responde sozinha no chat da live — exclusivo do Business), coleta de dados automatizada, onboarding dedicado e suporte prioritário. Teto de 24 horas por live.',
    shippingInfo: DIGITAL,
  },
  {
    name: 'Pacotes extras de créditos',
    priceBrl: null,
    aliases: ['créditos extras', 'recarga', 'comprar créditos', 'pacote de créditos', 'tokens', 'toques', 'mais créditos'],
    details:
      'Pra quem acabou os créditos do mês, em qualquer plano: 100 créditos por R$ 14,90; 300 créditos por R$ 39,90; 1.000 créditos por R$ 119,90. Compra no site, em Planos & Créditos. Crédito de IA não vira hora de live nem o contrário.',
    shippingInfo: DIGITAL,
  },
  {
    name: 'Horas de live avulsas',
    priceBrl: null,
    aliases: ['hora de live', 'horas extras de live', 'comprar hora', 'minutos de live', 'pacote de horas'],
    details:
      'Add-on pra qualquer plano: 1 hora por R$ 9,90; 5 horas por R$ 39,90; 15 horas por R$ 99,90; 40 horas por R$ 219,90. Hora de live não expira. Compra no site, em Planos & Créditos, e entra na carteira na hora.',
    shippingInfo: DIGITAL,
  },
  // ----------------------------------------------------------- módulos
  {
    name: 'Live Copilot (copiloto da live)',
    priceBrl: null,
    aliases: ['copiloto', 'co-piloto', 'copilot', 'live copilot', 'ia da live', 'robô da live', 'app da live', 'carro-chefe'],
    details:
      'O carro-chefe. Um app de computador (Windows) que acompanha o chat da sua live no TikTok e responde os clientes a partir da base de conhecimento que você montou. Dois modos: PAINEL (a resposta aparece na tela pra você copiar ou falar — não toca no chat, risco zero) e AUTOMÁTICO (só no Business, com aceite de termo: o app digita e envia no chat com cadência humana, 1 a cada 8 s, máx. 12 por minuto, e para sozinho se o TikTok mostrar aviso). Regras: nunca inventa preço (o preço vem do cadastro), nunca manda link ou @, ignora spam e provocação, e o que não sabe com segurança vai pro seu painel em vez de ir pro chat. Funciona com live gravada em loop: você grava uma vez, deixa rodando e o copiloto responde. Gasta HORAS de live (não créditos): cobra por minuto conectado, bloco mínimo de 10 minutos na abertura. Incluído em todos os planos.',
    shippingInfo: DIGITAL,
  },
  {
    name: 'Base de conhecimento da live',
    priceBrl: null,
    aliases: ['base de conhecimento', 'base', 'cadastro da live', 'ensinar a ia', 'transcrição da live', 'subir a gravação'],
    details:
      'É o que o copiloto sabe. Você sobe a GRAVAÇÃO da sua live (vídeo mp4/mov/mkv/webm, de 10 min a 5 h, até 2 GB): a plataforma extrai o áudio, transcreve e a IA identifica produtos, preços, variações, frete, promoção e as perguntas que o chat repetiu. Depois você revisa tudo: corrige preço, adiciona produto à mão, importa o catálogo por planilha CSV (o nome é a chave — reimportar atualiza), põe foto no produto, escreve respostas prontas, objeções e políticas da loja. Dá pra editar no meio da live e vale na próxima resposta. Custo da extração: transcrição 6 créditos a cada 10 min de gravação + 17 créditos da extração, uma vez por live. A base é sua, não expira e serve pra quantas lives quiser. A IA não sabe 100% do seu produto — você ensina os pontos que importam.',
    shippingInfo: DIGITAL,
  },
  {
    name: 'Descoberta de produtos, vídeos e criadores',
    priceBrl: null,
    aliases: ['descoberta', 'produtos que mais vendem', 'top 50', 'mais vendidos', 'vídeos que vendem', 'criadores que vendem', 'radar', 'tendências'],
    details:
      'Ranking dos produtos que mais vendem no TikTok Shop Brasil no mês, por categoria (saúde, bem-estar, casa, cozinha, beleza etc.) e o top 50 geral. Em cada produto: faturamento do período, preço médio, vendas, link pra ver no TikTok Shop, os vídeos que realmente venderam esse produto e os criadores por trás deles. Dali você gera roteiro em cima do produto ou do vídeo com um clique. Os dados NÃO são inventados: vêm por API de uma empresa especializada em dados do TikTok Shop, a mesma fonte que as plataformas usam. Não tem dados de Shopee. Incluído em todos os planos, sem gastar crédito pra navegar.',
    shippingInfo: DIGITAL,
  },
  {
    name: 'Estúdio: roteiros e análise de vídeo',
    priceBrl: null,
    aliases: ['estúdio', 'roteiro', 'roteirizador', 'análise de vídeo', 'analisar vídeo', 'transcrever vídeo', 'roteiro de live', 'imagem com ia'],
    details:
      'Roteiros com IA pra vídeo curto, live ou peças do multiplicador, a partir do seu produto ou de um produto da Descoberta — você escolhe o formato e quantas peças. Análise de vídeo: sobe ou cola um vídeo que está vendendo, a IA transcreve, explica por que funciona e adapta o roteiro pro seu produto. Transcrição de vídeo avulsa e imagens com IA pra thumbnail e criativo. Custos: roteiro 8 créditos, análise 12, imagem 12, transcrição 6 a cada 10 min. Disponível a partir do Essencial.',
    shippingInfo: DIGITAL,
  },
  {
    name: 'Fábrica de criativos (vídeo com IA e apresentador)',
    priceBrl: null,
    aliases: ['fábrica', 'fábrica de criativos', 'vídeo com ia', 'apresentador', 'avatar', 'kiko', 'gerar vídeo', 'vídeo do produto', 'campanha'],
    details:
      'Você cadastra o produto (nome, preço, benefício, problema que resolve, fotos em png/jpg/webp), cria um APRESENTADOR com IA (nome, gênero, idade, pele, cabelo, jeito, cenário — como o Kiko da demonstração) e a IA escreve o roteiro cena a cena. Cada cena pode ser: apresentador falando pra câmera com lábios sincronizados, só as mãos com o produto (unboxing), close do produto, ou só produto. Você escolhe duração (ex.: 15 s por cena) e quantas cenas; gera uma cena por vez ou todas; se não gostar, regera a cena. No fim a plataforma junta as cenas num vídeo só pra baixar e postar. Demora alguns minutos por cena porque é IA gerando vídeo de verdade — dá pra fazer outra coisa e voltar. Custo: 60 créditos por cena em vídeo (varia com a qualidade escolhida: natural, alta, ultra) + 1 crédito pra montar. Só no Pro e no Business. Ninguém precisa mostrar o próprio rosto.',
    shippingInfo: DIGITAL,
  },
  {
    name: 'Multiplicador de conteúdo',
    priceBrl: null,
    aliases: ['multiplicador', 'multiplicar vídeo', 'variações', 'gancho corpo cta', 'muitos vídeos', '150 vídeos'],
    details:
      'Você coloca um vídeo e ele gera dezenas de variações (até 150) recombinando gancho, corpo e CTA — é o que vendem por aí como "fórmula mágica", e é simples de propósito: montagem, sem IA inventando. Serve pra testar qual gancho converte e postar volume sem gravar de novo. Custo: 1 crédito por vídeo montado. Só no Pro e no Business.',
    shippingInfo: DIGITAL,
  },
  {
    name: 'Cortes automáticos de vídeo longo',
    priceBrl: null,
    aliases: ['cortes', 'corte', 'cortar vídeo', 'clipes', 'vídeo longo', 'corte inteligente', 'corte rápido'],
    details:
      'Sobe um vídeo longo (live, aula, review) e a plataforma transcreve e devolve vários cortes prontos pra postar, vertical, com legenda queimada. Corte rápido: 2 créditos por corte. Corte inteligente (a IA escolhe os trechos que funcionam sozinhos): 6 créditos por corte. Só no Pro e no Business.',
    shippingInfo: DIGITAL,
  },
  {
    name: 'Conta, pagamento e suporte',
    priceBrl: null,
    aliases: ['conta', 'cadastro', 'assinar', 'pagamento', 'stripe', 'cartão', 'pix', 'cancelar', 'reembolso', 'suporte', 'site', 'pikpokviral'],
    details:
      'Site PikPok Viral (link na bio). Cadastro com e-mail; o pagamento é pela Stripe, no cartão de crédito, mensal ou anual; acesso liberado na hora. Sem fidelidade: cancela quando quiser pelo painel e o acesso vale até o fim do período pago. Upgrade de plano a qualquer momento (paga a diferença). Créditos do plano renovam todo mês; os que sobram do mês não acumulam; créditos de pacote extra não vencem. Horas de live não expiram. Suporte pelo chat dentro do sistema em todos os planos; Business tem onboarding dedicado e suporte prioritário. Desktop do copiloto: Windows (Mac em breve). Hoje não tem teste grátis nem plano gratuito pra conta nova.',
    shippingInfo: DIGITAL,
  },
];

const FAQ: F[] = [
  // ------------------------------------------------ a live e o sistema
  { q: 'O que é o PikPok?', a: 'É um sistema pra vender mais no TikTok Shop: mostra o que mais vende, cria roteiros, vídeos com IA e cortes, e o Copiloto responde o chat da sua live.', produto: 'Live Copilot (copiloto da live)' },
  { q: 'Do que é a live? Primeira vez aqui', a: 'É a apresentação do PikPok: descoberta de produtos, Estúdio com IA e o Copiloto que responde o chat — que é quem tá te respondendo agora.', produto: 'Live Copilot (copiloto da live)' },
  { q: 'Essa live é gravada? Tem alguém aí?', a: 'É gravada e roda em loop — e quem te responde agora é o Copiloto do PikPok, exatamente o que você pode ter na sua live.', produto: 'Live Copilot (copiloto da live)' },
  { q: 'Quem está apresentando?', a: 'Quem apresenta é o criador do PikPok, numa live gravada; quem responde o chat agora é o Copiloto, com base no que ele cadastrou.', produto: 'Live Copilot (copiloto da live)' },
  { q: 'É uma IA respondendo?', a: 'Sim! É o Copiloto do PikPok lendo o chat e respondendo com o que foi cadastrado na base. É isso que você leva pra sua live.', produto: 'Live Copilot (copiloto da live)' },
  { q: 'Isso é golpe? É real?', a: 'É real — você está vendo o sistema funcionando agora: esta resposta foi o Copiloto que escreveu. O site oficial tá na bio.', kind: 'objecao', produto: 'Conta, pagamento e suporte' },
  { q: 'Pra quem é o PikPok?', a: 'Pra quem vende no TikTok Shop: lojista, afiliado ou criador que faz live e vídeo de produto e quer parar de ficar o dia inteiro respondendo chat e editando.', produto: 'Live Copilot (copiloto da live)' },
  { q: 'Serve pra afiliado?', a: 'Serve. Afiliado usa a Descoberta pra achar produto que vende, a Fábrica pra fazer o vídeo sem aparecer e o Copiloto na live.', produto: 'Descoberta de produtos, vídeos e criadores' },
  { q: 'Serve pra quem está começando?', a: 'Serve — a Descoberta mostra o que já vende, o roteiro vem pronto e o vídeo é gerado com IA. Você começa sem precisar aparecer nem editar.', produto: 'Descoberta de produtos, vídeos e criadores' },

  // ----------------------------------------------------------- copiloto
  { q: 'O que é o Copiloto / carro-chefe?', a: 'O Copiloto lê o chat da sua live e responde seus clientes com base no que você cadastrou. Grava a live uma vez, deixa em loop e a IA vende por você.', produto: 'Live Copilot (copiloto da live)' },
  { q: 'Como o copiloto sabe responder sobre meu produto?', a: 'Você sobe a gravação da sua live: a plataforma transcreve, entende preço, variação e frete e monta a base. Depois você revisa e ensina o que faltar.', produto: 'Base de conhecimento da live' },
  { q: 'A IA sabe tudo do meu produto?', a: 'Não — e ninguém sabe 100%. Você ensina os pontos que importam (preço, variações, frete, promoção) e ela responde a partir disso, sem inventar.', produto: 'Base de conhecimento da live' },
  { q: 'A IA pode inventar um preço errado?', a: 'Não. O preço sempre vem do que você cadastrou; a IA nunca cria valor. Se não sabe, ela manda pro seu painel pra você responder.', produto: 'Live Copilot (copiloto da live)' },
  { q: 'E se a IA responder errado?', a: 'Ela só responde o que você cadastrou, nunca inventa preço, e o que não sabe com segurança vai pro seu painel. Você continua no controle.', kind: 'objecao', produto: 'Live Copilot (copiloto da live)' },
  { q: 'A IA responde sozinha no chat ou eu preciso copiar?', a: 'Nos dois jeitos: no modo painel a resposta aparece pra você copiar ou falar; no Business o envio automático manda direto no chat.', produto: 'Live Copilot (copiloto da live)' },
  { q: 'O que é o modo painel?', a: 'A resposta aparece na tela do app pra você copiar ou falar em voz alta. Não toca no chat do TikTok — risco zero, e já vem em todos os planos.', produto: 'Live Copilot (copiloto da live)' },
  { q: 'O que é o envio automático?', a: 'O app digita e envia a resposta no chat por você, com ritmo humano. É opcional, exclusivo do Business e exige aceitar um termo antes de ligar.', produto: 'Plano Business' },
  { q: 'É seguro? Não corre risco de banir a conta no TikTok?', a: 'No modo painel não toca no chat, risco zero. O automático é opcional, só no Business, com termo, cadência humana e pausa sozinho se o TikTok avisar.', produto: 'Live Copilot (copiloto da live)' },
  { q: 'O TikTok permite isso?', a: 'O modo painel é 100% dentro das regras — só você escreve no chat. O envio automático é por sua conta, e por isso pede aceite de termo e só existe no Business.', produto: 'Live Copilot (copiloto da live)' },
  { q: 'Quantas respostas por minuto o automático manda?', a: 'No máximo 1 a cada 8 segundos e 12 por minuto — ritmo de gente, de propósito, pra não parecer robô.', produto: 'Live Copilot (copiloto da live)' },
  { q: 'Preciso instalar alguma coisa?', a: 'A base e o Estúdio são no site. Pra rodar o Copiloto na live você instala o app de computador (Windows), que conecta ao chat da transmissão.', produto: 'Live Copilot (copiloto da live)' },
  { q: 'Funciona pelo celular?', a: 'O site funciona no celular. O Copiloto ao vivo roda no computador, porque é ele que acompanha o chat da live.', produto: 'Live Copilot (copiloto da live)' },
  { q: 'Tem pra Mac?', a: 'Hoje o app do Copiloto é pra Windows; Mac está a caminho. O site funciona em qualquer sistema.', produto: 'Conta, pagamento e suporte' },
  { q: 'Como deixo a live em loop?', a: 'Grava a live uma vez, monta a base a partir dela e transmite a gravação em loop pelo tempo que quiser — o Copiloto responde enquanto ela roda.', produto: 'Live Copilot (copiloto da live)' },
  { q: 'Preciso ficar na frente do computador durante a live?', a: 'No modo painel sim, pra copiar ou falar as respostas. No automático (Business) o app responde sozinho e só te chama no que não souber.', produto: 'Live Copilot (copiloto da live)' },
  { q: 'O copiloto responde spam e provocação?', a: 'Não. Ele ignora emoji, spam, xingamento e papo aleatório; só responde pergunta sobre a live. E você pode bloquear @ específicos.', produto: 'Live Copilot (copiloto da live)' },
  { q: 'O copiloto manda link no chat?', a: 'Nunca — link e @ são gatilho de bloqueio no TikTok. Ele responde em texto e manda o cliente pro carrinho ou pra bio.', produto: 'Live Copilot (copiloto da live)' },
  { q: 'Posso corrigir a IA no meio da live?', a: 'Pode. Edita produto ou resposta na base pelo site e a próxima resposta já sai corrigida. O que ela escalou você responde no painel e vira aprendizado.', produto: 'Base de conhecimento da live' },
  { q: 'A IA aprende com as lives?', a: 'Sim: toda pergunta que ela não soube e você respondeu no painel entra na base como resposta pronta pra próxima live.', produto: 'Base de conhecimento da live' },
  { q: 'Funciona com live de qualquer produto?', a: 'Funciona com qualquer coisa que você venda em live no TikTok Shop: roupa, eletrônico, cosmético, kit… A base é montada da sua própria live.', produto: 'Base de conhecimento da live' },
  { q: 'Quantos produtos cabem na base?', a: 'Dezenas a centenas: pode importar o catálogo inteiro por planilha CSV além do que a IA extrai da gravação.', produto: 'Base de conhecimento da live' },
  { q: 'Posso importar meu catálogo?', a: 'Pode, por planilha CSV: nome, preço, variações, frete. O nome é a chave, então reimportar a planilha atualiza os preços sem duplicar.', produto: 'Base de conhecimento da live' },
  { q: 'Que arquivo de live eu subo?', a: 'O vídeo da gravação (mp4, mov, mkv ou webm), de 10 minutos a 5 horas, até 2 GB. Só áudio não serve.', produto: 'Base de conhecimento da live' },
  { q: 'Quanto custa montar a base da live?', a: '6 créditos a cada 10 minutos de gravação pra transcrever + 17 créditos da extração, uma vez. Uma live de 1 hora sai em 53 créditos.', produto: 'Base de conhecimento da live' },
  { q: 'O copiloto fixa produto na live?', a: 'Tenta: dá pra fixar pelo app e ligar rotação automática dos produtos. Se o TikTok mudar a tela, ele avisa e você fixa à mão.', produto: 'Live Copilot (copiloto da live)' },
  { q: 'O copiloto gasta crédito?', a: 'Não — a live gasta HORAS de live, por minuto conectado (bloco mínimo de 10 min). Seus créditos ficam pra roteiro e vídeo.', produto: 'Horas de live avulsas' },
  { q: 'Mostra quantas pessoas estão vendo?', a: 'Sim: o app registra espectadores, curtidas e presentes da live, e no fim mostra quantas perguntas respondeu e quantas você usou.', produto: 'Live Copilot (copiloto da live)' },

  // ------------------------------------------------------------ estúdio
  { q: 'O que são os cortes?', a: 'Sobe um vídeo longo e a IA transcreve e devolve vários cortes verticais prontos pra postar, com legenda. Acabou ficar editando.', produto: 'Cortes automáticos de vídeo longo' },
  { q: 'Quanto custa o corte?', a: 'Corte rápido 2 créditos; corte inteligente (a IA escolhe os melhores trechos) 6 créditos por corte. A partir do Pro.', produto: 'Cortes automáticos de vídeo longo' },
  { q: 'O que é o multiplicador de vídeo?', a: 'Você coloca um vídeo e ele gera dezenas de variações (até 150) recombinando gancho, corpo e CTA. Simples, direto, sem fórmula mágica.', produto: 'Multiplicador de conteúdo' },
  { q: 'Quanto custa multiplicar?', a: '1 crédito por vídeo montado. Com 1.000 créditos do Pro dá pra fazer muito volume.', produto: 'Multiplicador de conteúdo' },
  { q: 'O que é a análise de vídeo?', a: 'Sobe ou cola um vídeo que vende: a IA transcreve, explica por que funciona e gera um roteiro adaptado pro seu produto. 12 créditos.', produto: 'Estúdio: roteiros e análise de vídeo' },
  { q: 'Faz roteiro pra mim?', a: 'Faz: roteiro de vídeo curto, de live ou peças pro multiplicador, a partir do seu produto ou de um produto da Descoberta. 8 créditos por roteiro.', produto: 'Estúdio: roteiros e análise de vídeo' },
  { q: 'O que é a fábrica de criativos?', a: 'Cadastra o produto com fotos, cria um apresentador com IA e ela gera o vídeo cena a cena, com fala sincronizada, e junta tudo num vídeo só.', produto: 'Fábrica de criativos (vídeo com IA e apresentador)' },
  { q: 'Preciso aparecer nos vídeos?', a: 'Não. Você cria um apresentador com IA (como o Kiko da demonstração) e ele apresenta seu produto por você.', produto: 'Fábrica de criativos (vídeo com IA e apresentador)' },
  { q: 'Quem é o Kiko?', a: 'O Kiko é um apresentador criado com IA na demonstração: homem, 25 a 34 anos, animado, no quarto dele. Você cria o seu do jeito que quiser.', produto: 'Fábrica de criativos (vídeo com IA e apresentador)' },
  { q: 'O apresentador fala mesmo? A boca sincroniza?', a: 'Fala o texto do roteiro com os lábios sincronizados, olhando pra câmera. Você viu na demo do batom.', produto: 'Fábrica de criativos (vídeo com IA e apresentador)' },
  { q: 'Posso usar meu próprio rosto ou minha foto?', a: 'Hoje o apresentador é gerado pela IA a partir da descrição. O produto sim entra com as suas fotos reais.', produto: 'Fábrica de criativos (vídeo com IA e apresentador)' },
  { q: 'Por que demora pra gerar o vídeo?', a: 'É IA gerando vídeo de verdade, não template. Leva alguns minutos por cena — faz outra coisa e volta, ele fica em Minhas gerações.', produto: 'Fábrica de criativos (vídeo com IA e apresentador)' },
  { q: 'Posso refazer uma cena se não gostar?', a: 'Pode. Cada cena pode ser regerada, e no fim a plataforma junta as cenas num vídeo só pra baixar e postar.', produto: 'Fábrica de criativos (vídeo com IA e apresentador)' },
  { q: 'Quanto custa o vídeo com IA?', a: '60 créditos por cena em vídeo (muda um pouco com a qualidade) + 1 pra montar. Um vídeo de 3 cenas sai em ~181 créditos.', produto: 'Fábrica de criativos (vídeo com IA e apresentador)' },
  { q: 'Que formato de foto o produto aceita?', a: 'PNG, JPG ou WEBP. Vale a pena colocar 2 ou 3 fotos: é delas que a IA mostra o produto nas cenas de mão e close.', produto: 'Fábrica de criativos (vídeo com IA e apresentador)' },
  { q: 'Posso fazer vídeo de 1 minuto?', a: 'Pode: escolhe quantas cenas e a duração de cada uma. Mais cenas = mais créditos, óbvio.', produto: 'Fábrica de criativos (vídeo com IA e apresentador)' },
  { q: 'O vídeo tem marca d’água?', a: 'Não. Você baixa o vídeo final e posta como seu.', produto: 'Fábrica de criativos (vídeo com IA e apresentador)' },
  { q: 'De onde vêm os produtos mais vendidos? É inventado?', a: 'Não é inventado: vem por API de uma empresa especializada em dados do TikTok Shop. São os mais vendidos do mês, por categoria, com faturamento e preço médio.', produto: 'Descoberta de produtos, vídeos e criadores' },
  { q: 'Dá pra ver os criadores e vídeos que mais vendem?', a: 'Sim. Além dos produtos, você vê os vídeos que realmente venderam e os criadores por trás — e gera roteiro em cima com um clique.', produto: 'Descoberta de produtos, vídeos e criadores' },
  { q: 'Os dados atualizam?', a: 'Atualizam: o ranking é do mês corrente e mostra o período, faturamento e preço médio de cada produto.', produto: 'Descoberta de produtos, vídeos e criadores' },
  { q: 'Navegar na descoberta gasta crédito?', a: 'Não. Olhar produtos, vídeos e criadores é livre; crédito só quando você pede roteiro, análise ou vídeo.', produto: 'Descoberta de produtos, vídeos e criadores' },
  { q: 'Serve pra Shopee ou só TikTok Shop?', a: 'O foco hoje é TikTok Shop — os dados de produtos e criadores são de lá. O Estúdio (roteiros, vídeos, cortes) serve pra qualquer plataforma.', produto: 'Descoberta de produtos, vídeos e criadores' },
  { q: 'Funciona pra Instagram, Reels, Kwai?', a: 'Os vídeos e cortes saem em vertical e você posta onde quiser. A Descoberta e o Copiloto são do TikTok Shop.', produto: 'Cortes automáticos de vídeo longo' },

  // -------------------------------------------------------------- preço
  { q: 'Quanto custa? Quais são os planos?', a: 'Essencial R$ 39,90 (450 créditos), Pro R$ 89,90 (1.000 créditos) e Business R$ 249,90 (2.800 créditos). Todos já vêm com horas de live.', produto: 'Plano Pro' },
  { q: 'Qual plano você recomenda?', a: 'O Pro: 1.000 créditos, 40 h de live, vídeo com IA, multiplicador e cortes. E hoje com o código "mestre" ele dobra.', produto: 'Plano Pro' },
  { q: 'Qual a oferta da live? Como uso o código mestre?', a: 'Assina o Pro de R$ 89,90, chama no direct do TikTok e fala "mestre, vi o vídeo na live": a gente dobra pra 2.000 créditos e 80 horas de live.', produto: 'Plano Pro' },
  { q: 'Até quando vale a oferta / o código?', a: 'Vale pra quem está assistindo esta live e chamar no direct depois de assinar o Pro. Não deixa pra depois.', produto: 'Plano Pro' },
  { q: 'O código mestre vale pro Essencial ou pro Business?', a: 'A oferta é do Pro de R$ 89,90. Com ela o Pro fica com 2.000 créditos e 80 h — mais horas que o Business.', produto: 'Plano Pro' },
  { q: 'O que tem no Essencial?', a: 'R$ 39,90: 450 créditos/mês, 15 h de live, descoberta completa, roteiros, análises, transcrição, imagens e o Copiloto no painel.', produto: 'Plano Essencial' },
  { q: 'O que tem no Pro?', a: 'R$ 89,90: 1.000 créditos/mês, 40 h de live, tudo do Essencial + vídeo com IA, multiplicador e cortes. Até 6 h por live.', produto: 'Plano Pro' },
  { q: 'O que tem no Business?', a: 'R$ 249,90: 2.800 créditos/mês, 60 h de live, envio automático no chat, coleta automatizada, onboarding dedicado e suporte prioritário.', produto: 'Plano Business' },
  { q: 'Qual a diferença do Essencial pro Pro?', a: 'O Pro tem vídeo com IA (Fábrica), multiplicador e cortes, 1.000 créditos e 40 h de live. O Essencial é roteiro, análise, imagem e copiloto.', produto: 'Plano Pro' },
  { q: 'Qual a diferença do Pro pro Business?', a: 'O Business tem 2.800 créditos, 60 h de live, envio automático no chat, coleta automatizada, onboarding dedicado e suporte prioritário.', produto: 'Plano Business' },
  { q: 'Quantas horas de live vêm em cada plano?', a: 'Essencial 15 h, Pro 40 h e Business 60 h — creditadas uma vez na adesão. Hora de live não expira.', produto: 'Horas de live avulsas' },
  { q: 'As horas de live renovam todo mês?', a: 'Não, são um bônus único da adesão. Quando acabar, tem hora avulsa a partir de R$ 9,90 a hora.', produto: 'Horas de live avulsas' },
  { q: 'Quanto custa a hora de live extra?', a: '1 h R$ 9,90; 5 h R$ 39,90; 15 h R$ 99,90; 40 h R$ 219,90. Não expira.', produto: 'Horas de live avulsas' },
  { q: 'O que é crédito? O que gasta crédito?', a: 'Crédito é a moeda das gerações: roteiro 8, análise 12, imagem 12, vídeo com IA 60 por cena, corte 2 ou 6, transcrição 6 a cada 10 min.', produto: 'Pacotes extras de créditos' },
  { q: 'Quantos vídeos faço com 1.000 créditos?', a: 'Uns 5 vídeos de 3 cenas com IA (~180 cada), ou 125 roteiros, ou 160 cortes inteligentes — mistura como quiser.', produto: 'Plano Pro' },
  { q: 'Crédito vira hora de live?', a: 'Não, são separados de propósito: sua live nunca consome os créditos que você guardou pra criar vídeos.', produto: 'Pacotes extras de créditos' },
  { q: 'Acabou o crédito, e aí?', a: 'Compra um pacote: 100 por R$ 14,90, 300 por R$ 39,90 ou 1.000 por R$ 119,90. Créditos de pacote não vencem.', produto: 'Pacotes extras de créditos' },
  { q: 'Crédito acumula pro mês seguinte?', a: 'Os do plano renovam todo mês e não acumulam; os de pacote extra ficam até você usar.', produto: 'Pacotes extras de créditos' },
  { q: 'Tem plano anual? Tem desconto?', a: 'Tem: Essencial R$ 399,90/ano (4.600 créditos), Pro R$ 899,90/ano (10.400) e Business R$ 2.499,90/ano (28.800) — dois meses grátis.', produto: 'Plano Pro' },
  { q: 'Tem plano grátis ou teste?', a: 'Hoje não tem teste grátis: começa pelo Essencial de R$ 39,90, que já vem com 15 horas de live pra testar o Copiloto de verdade.', produto: 'Plano Essencial' },
  { q: 'Tem desconto pra pagar no ano?', a: 'Tem — o anual sai com 2 meses grátis: Pro R$ 899,90 em vez de 12 × 89,90.', produto: 'Plano Pro' },
  { q: 'Tem cupom?', a: 'O cupom de hoje é o código "mestre" no direct, depois de assinar o Pro: dobra créditos e horas.', produto: 'Plano Pro' },
  { q: 'Posso mudar de plano depois?', a: 'Pode fazer upgrade a qualquer momento pelo site, pagando só a diferença.', produto: 'Conta, pagamento e suporte' },

  // ------------------------------------------------------ conta/pagamento
  { q: 'Como faço pra assinar / começar?', a: 'Entra no site (tá na bio), cria a conta e escolhe o plano — pagamento pela Stripe, acesso na hora. Quer a oferta? Chama no direct com "mestre".', produto: 'Conta, pagamento e suporte' },
  { q: 'Onde é o site?', a: 'O link do site tá na bio do perfil. É PikPok Viral.', produto: 'Conta, pagamento e suporte' },
  { q: 'Como pago? Aceita Pix ou cartão?', a: 'Pagamento pela Stripe, no cartão de crédito, mensal ou anual. Cancela quando quiser.', produto: 'Conta, pagamento e suporte' },
  { q: 'Aceita boleto?', a: 'Hoje é cartão de crédito pela Stripe. Se precisar de outra forma, chama no direct que a gente vê.', produto: 'Conta, pagamento e suporte' },
  { q: 'Posso cancelar quando quiser?', a: 'Pode, sem fidelidade. Cancela pelo painel e o acesso vale até o fim do período pago.', produto: 'Conta, pagamento e suporte' },
  { q: 'Tem fidelidade? Tem multa?', a: 'Não tem fidelidade nem multa. Assinatura mensal, cancela quando quiser.', produto: 'Conta, pagamento e suporte' },
  { q: 'Tem suporte? Tem ajuda pra configurar?', a: 'Tem suporte pelo chat dentro do sistema em todos os planos; o Business tem onboarding dedicado e suporte prioritário.', produto: 'Conta, pagamento e suporte' },
  { q: 'Tem tutorial?', a: 'Tem o passo a passo dentro do sistema e o suporte no chat. E esta live mostra tudo funcionando — ela roda em loop, pode ver de novo.', produto: 'Conta, pagamento e suporte' },
  { q: 'Meus dados e minha conta do TikTok ficam seguros?', a: 'Sua senha do TikTok fica só no seu computador; o servidor nunca vê. O @ de quem pergunta no chat é anonimizado antes de sair da sua máquina.', produto: 'Live Copilot (copiloto da live)' },
  { q: 'Posso usar em mais de um computador?', a: 'Pode ativar o app em outro computador com a mesma conta; a base é sua e aparece em todos.', produto: 'Conta, pagamento e suporte' },
  { q: 'Emite nota fiscal?', a: 'Emite — a assinatura é pela Stripe e a nota vai no seu e-mail. Dúvida de cobrança, fala com o suporte no chat.', produto: 'Conta, pagamento e suporte' },

  // ----------------------------------------------------------- objeções
  { q: 'Tá caro.', a: 'Pensa no que custa uma hora sua ao vivo: por R$ 89,90 são 40 h de live respondida e 1.000 créditos de vídeo. Uma venda paga o mês.', kind: 'objecao', produto: 'Plano Pro' },
  { q: 'Faz um precinho melhor aí', a: 'O precinho é o código "mestre": assina o Pro de R$ 89,90 e ganha o dobro — 2.000 créditos e 80 h de live.', kind: 'objecao', produto: 'Plano Pro' },
  { q: 'Não sei mexer com isso, é complicado?', a: 'É subir a gravação da live, revisar a lista que a IA montou e ligar o app. Se travar, o suporte te acompanha.', kind: 'objecao', produto: 'Conta, pagamento e suporte' },
  { q: 'Não tenho tempo de aprender', a: 'O sistema existe pra te devolver tempo: roteiro, vídeo e chat feitos pela IA. Em uma noite você monta a primeira base.', kind: 'objecao', produto: 'Conta, pagamento e suporte' },
  { q: 'Vou pensar / depois eu vejo', a: 'Tranquilo — só lembra que o código "mestre" que dobra o Pro é pra quem está na live agora.', kind: 'objecao', produto: 'Plano Pro' },
  { q: 'Já uso outra ferramenta', a: 'Compara: aqui tem descoberta, vídeo com IA, cortes e o Copiloto na live no mesmo plano, sem gastar crédito pra live.', kind: 'objecao', produto: 'Plano Pro' },
  { q: 'IA não vende, cliente percebe', a: 'O cliente recebe a resposta certa com o preço certo em segundos — é isso que vende. E o que ela não sabe vai pra você, não pro chat.', kind: 'objecao', produto: 'Live Copilot (copiloto da live)' },
  { q: 'Vídeo de IA fica estranho', a: 'Você viu o do batom: segue o roteiro, boca sincronizada, e dá pra refazer qualquer cena até ficar do seu jeito.', kind: 'objecao', produto: 'Fábrica de criativos (vídeo com IA e apresentador)' },
  { q: 'Tenho medo de perder a conta', a: 'Então usa o painel: a IA escreve, você decide o que vai pro chat. Nada é publicado sem a sua mão.', kind: 'objecao', produto: 'Live Copilot (copiloto da live)' },
  { q: 'Isso funciona mesmo? Alguém já usou?', a: 'Funciona — está funcionando com você agora. Testa no Essencial com 15 h de live inclusas.', kind: 'objecao', produto: 'Plano Essencial' },
  { q: 'Não vendo no TikTok ainda', a: 'Então começa pela Descoberta: ela mostra o que já vende e o roteiro sai pronto. A live vem depois.', kind: 'objecao', produto: 'Descoberta de produtos, vídeos e criadores' },

  // ----------------------------------------------------------- políticas
  { q: 'Política de reembolso', a: 'Sem fidelidade: cancela quando quiser e mantém o acesso até o fim do período. Dúvida sobre cobrança, fala com o suporte no chat do sistema.', kind: 'politica', produto: 'Conta, pagamento e suporte' },
  { q: 'Política de créditos', a: 'Créditos do plano renovam por mês e não acumulam; créditos de pacote não vencem; crédito e hora de live não se convertem.', kind: 'politica', produto: 'Pacotes extras de créditos' },
  { q: 'Política de horas de live', a: 'Horas do plano entram uma vez na adesão; horas avulsas a partir de R$ 9,90; hora não expira; cobra por minuto conectado, mínimo 10 min por live.', kind: 'politica', produto: 'Horas de live avulsas' },
  { q: 'Política de uso do envio automático', a: 'Só no Business, com aceite de termo. Máximo 12 respostas por minuto, nunca link ou @, pausa sozinho se o TikTok mostrar aviso. Painel é o padrão.', kind: 'politica', produto: 'Plano Business' },
  { q: 'Política de privacidade do chat', a: 'O @ de quem pergunta é anonimizado antes de sair do seu computador; mensagens do chat ficam 30 dias; sua senha do TikTok nunca vai pro servidor.', kind: 'politica', produto: 'Live Copilot (copiloto da live)' },
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

    const nomes = new Set(PRODUTOS.map((p) => p.name));
    const orfas = FAQ.filter((f) => !nomes.has(f.produto));
    if (orfas.length) {
      throw new Error(`FAQ apontando para produto inexistente: ${orfas.map((f) => f.q).join(' | ')}`);
    }

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
          liveProductId: porNome.get(f.produto) ?? null,
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
      `Base montada na sessão ${sessionId}: ${salvos.length} produtos, ${FAQ.length} FAQ (${FAQ.filter((f) => f.kind === 'objecao').length} objeções, ${FAQ.filter((f) => f.kind === 'politica').length} políticas). Status: pronta.`,
    );
  } finally {
    await app.close();
  }
}

void main().catch((e) => {
  console.error(e instanceof Error ? e.stack : String(e));
  process.exitCode = 1;
});
