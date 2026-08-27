import {
  AutoFixHighRounded,
  GroupsRounded,
  InsightsRounded,
  LocalFireDepartmentRounded,
  MovieFilterRounded,
  OndemandVideoRounded,
  SchoolRounded,
  StyleRounded,
} from '@mui/icons-material';
import { ReactNode } from 'react';

export const NAV_LINKS = [
  { href: '#recursos', label: 'Recursos' },
  { href: '#como-funciona', label: 'Como funciona' },
  { href: '#depoimentos', label: 'Depoimentos' },
  { href: '#planos', label: 'Planos' },
  { href: '#faq', label: 'FAQ' },
];

export interface Feature {
  icon: ReactNode;
  title: string;
  desc: string;
  tag: string;
}

/** Cards menores do bento — os dois destaques ficam no próprio componente. */
export const FEATURES: Feature[] = [
  {
    icon: <OndemandVideoRounded />,
    tag: 'Conteúdo',
    title: 'Vídeos que vendem',
    desc: 'Os vídeos com maior conversão por nicho, com os ganchos, formatos e CTAs que estão funcionando agora.',
  },
  {
    icon: <GroupsRounded />,
    tag: 'Parcerias',
    title: 'Radar de criadores',
    desc: 'Encontre criadores por nicho, engajamento e GMV para fechar parcerias antes da concorrência.',
  },
  {
    icon: <StyleRounded />,
    tag: 'Biblioteca',
    title: 'Cofre de prompts',
    desc: 'Prompts testados para criativos, legendas e respostas de comentários que aumentam a conversão.',
  },
  {
    icon: <InsightsRounded />,
    tag: 'Sinais',
    title: 'Tendências antecipadas',
    desc: 'Monitore categorias, hashtags e sons em ascensão e chegue antes do pico da tendência.',
  },
  {
    icon: <MovieFilterRounded />,
    tag: 'Produção',
    title: 'Multiplicador de conteúdo',
    desc: 'Transforme um vídeo campeão em dezenas de variações prontas para testar em escala.',
  },
  {
    icon: <SchoolRounded />,
    tag: 'Academy',
    title: 'PikPok Academy',
    desc: 'Trilhas curtas e diretas sobre afiliação, criativos e escala no TikTok Shop.',
  },
  {
    icon: <AutoFixHighRounded />,
    tag: 'IA',
    title: 'Análise de virais',
    desc: 'Cole a URL de um vídeo e receba a transcrição, a estrutura do gancho e o porquê de ter performado.',
  },
];

export const HIGHLIGHTS = [
  {
    icon: <LocalFireDepartmentRounded />,
    tag: 'Descoberta',
    title: 'Produtos em alta, atualizados todo dia',
    desc: 'Ranking diário do TikTok Shop com receita estimada, comissão, saturação e velocidade de crescimento — filtrado pelo seu nicho.',
  },
  {
    icon: <AutoFixHighRounded />,
    tag: 'Estúdio IA',
    title: 'Do produto ao roteiro em segundos',
    desc: 'Gancho, corpo e CTA gerados a partir dos vídeos que já provaram converter naquele produto. Imagem e vídeo com IA inclusos.',
  },
];

export const STEPS = [
  {
    n: '01',
    title: 'Descubra',
    desc: 'Filtre os produtos em alta por nicho, comissão, preço e concorrência. Salve os favoritos.',
    bullets: ['Ranking diário', 'Filtro por comissão', 'Alertas de saturação'],
  },
  {
    n: '02',
    title: 'Analise',
    desc: 'Veja os vídeos e criadores que já provaram que o produto vende — e o que exatamente fizeram.',
    bullets: ['Transcrição do viral', 'Estrutura do gancho', 'Criadores do nicho'],
  },
  {
    n: '03',
    title: 'Crie',
    desc: 'Gere o roteiro com IA, multiplique em variações e publique antes do mercado saturar.',
    bullets: ['Roteiro pronto', 'Variações em lote', 'Imagem e vídeo com IA'],
  },
];

export const NICHES = [
  'Beleza', 'Casa inteligente', 'Fitness', 'Gadgets', 'Cozinha', 'Moda', 'Pet', 'Maquiagem',
  'Organização', 'Skincare', 'Eletrônicos', 'Infantil', 'Automotivo', 'Suplementos',
];

export const TICKER_WORDS = ['viral', 'lucrativo', 'em alta', 'tendência'];

export const COMPARISON: Array<{ label: string; without: string; with: string }> = [
  { label: 'Achar o produto certo', without: 'Rolar o feed por horas e apostar no achismo', with: 'Ranking diário com receita, comissão e saturação' },
  { label: 'Entender por que vendeu', without: 'Assistir vídeo por vídeo sem método', with: 'Transcrição, gancho e estrutura destrinchados pela IA' },
  { label: 'Produzir criativo', without: 'Travar na página em branco', with: 'Roteiro pronto em segundos + variações em lote' },
  { label: 'Timing', without: 'Entrar quando o nicho já saturou', with: 'Sinal de tendência com ~48h de antecedência' },
  { label: 'Parcerias', without: 'Prospecção manual no escuro', with: 'Criadores filtrados por nicho, engajamento e GMV' },
];

export const TESTIMONIALS = [
  {
    name: 'Marina Reis',
    role: 'Afiliada · nicho beleza',
    quote: 'Achei o mini ring light no PikPok dois dias antes de explodir. Foi o meu melhor mês de comissão até hoje.',
    metric: 'R$ 18k em comissão no mês',
    initials: 'MR',
  },
  {
    name: 'Diego Alencar',
    role: 'Seller · casa e cozinha',
    quote: 'A parte que mudou o jogo foi o Estúdio. Eu saía do produto pro roteiro gravado em menos de dez minutos.',
    metric: '6 criativos por dia',
    initials: 'DA',
  },
  {
    name: 'Bianca Lopes',
    role: 'Agência de criadores',
    quote: 'Uso o radar de criadores pra montar campanha inteira. Filtro por GMV e engajamento e já saio com a lista pronta.',
    metric: '40+ parcerias fechadas',
    initials: 'BL',
  },
  {
    name: 'Rafa Menezes',
    role: 'Afiliado · gadgets',
    quote: 'O multiplicador me deu 20 variações do vídeo campeão. Testei todas e uma delas passou de 1M de views.',
    metric: '1,2M de views em 1 vídeo',
    initials: 'RM',
  },
];

export const FAQ = [
  {
    q: 'Preciso ter loja no TikTok Shop para usar?',
    a: 'Não. O PikPok funciona tanto para afiliados quanto para sellers — a descoberta de produtos, vídeos e criadores independe de você ter loja própria.',
  },
  {
    q: 'De onde vêm os dados?',
    a: 'Coletamos e consolidamos sinais públicos do TikTok Shop e do próprio TikTok — produtos, vídeos, criadores, hashtags e sons — e atualizamos os rankings diariamente.',
  },
  {
    q: 'Como funcionam os créditos?',
    a: 'Ações com IA (roteiro, análise de viral, transcrição, imagem e vídeo) consomem créditos. Todo plano vem com uma cota mensal e você pode comprar pacotes avulsos quando precisar. A descoberta de produtos, vídeos e criadores não consome crédito. O copiloto ao vivo é diferente: ele gasta horas de live, uma moeda separada que não sai dos seus créditos. O plano já vem com horas na adesão (15h no Essencial, 40h no Pro, 60h no Business) e, se precisar de mais, há pacotes: 1h por R$ 9,90, 5h por R$ 39,90, 15h por R$ 99,90 e 40h por R$ 219,90.',
  },
  {
    q: 'Posso cancelar quando quiser?',
    a: 'Sim. A assinatura é mensal, sem fidelidade, e você cancela pelo próprio painel. O acesso continua válido até o fim do período já pago.',
  },
  {
    q: 'Preciso de cartão para testar?',
    a: 'Não. O plano Free é permanente e você ainda ganha 250 créditos de boas-vindas no cadastro para experimentar as ferramentas de IA, além de 10 minutos de Live Copilot de cortesia para ver o copiloto respondendo o seu chat de verdade.',
  },
  {
    q: 'Os roteiros gerados são originais?',
    a: 'Sim. A IA usa os padrões que funcionaram como referência de estrutura, mas escreve um roteiro novo para o seu produto, seu tom e seu público.',
  },
];

/** Espelha `backend/src/modules/billing/billing.config.ts` — mantenha os dois lados iguais. */
// Sem plano Free: ele saiu do produto quando o acesso passou a ser só para
// assinantes. A landing anunciava "Free — descoberta completa", justamente o
// que o paywall fecha; quem se cadastrasse por essa promessa bateria na tela de
// pagamento. Quem quer conhecer antes usa a amostra pública (LiveSample).
// Espelho de PLANS (backend/src/modules/billing/billing.config.ts). Se os dois
// divergirem, a landing mente sobre o preço — mantenha-os juntos.
//
// O tipo é explícito porque `listPrice`/`offerLabel` (preço riscado de uma
// promoção) hoje não estão em uso: sem a anotação, o TS os infere como
// inexistentes e a seção de planos, que sabe exibi-los, para de compilar
// assim que a última oferta sai do ar.
export interface PricingPlan {
  id: string;
  name: string;
  price: number;
  tagline: string;
  perks: string[];
  highlight?: boolean;
  listPrice?: number;
  offerLabel?: string;
  annual?: { price: number; credits: string };
}

// A landing não importa o backend (são builds separados), então os perks abaixo
// são cópia LITERAL de `PLANS[*].perks` em billing.config.ts — a fonte da
// verdade. Só o item de cota fica sem o "(ou N no plano anual)", porque o card
// já mostra a cota anual na linha do preço. Ao mudar um perk lá, mude aqui.
export const PRICING: PricingPlan[] = [
  {
    id: 'essencial',
    name: 'Essencial',
    price: 39.9,
    annual: { price: 399.9, credits: '6.670 créditos no ano' },
    tagline: 'Para começar a garimpar',
    perks: [
      '650 créditos/mês',
      'Descoberta completa: produtos, vídeos e criadores',
      'Roteiros e análises com IA',
      'Transcrição de vídeos',
      'Imagens com IA',
      'Live Copilot no painel: o plano vem com 15 horas de live',
    ],
  },
  {
    id: 'pro',
    name: 'Pro',
    price: 89.9,
    annual: { price: 899.9, credits: '15.080 créditos no ano' },
    tagline: 'Para quem publica toda semana',
    highlight: true,
    perks: [
      '1.450 créditos/mês',
      'Tudo do Essencial',
      'Vídeos com IA',
      'Multiplicador de conteúdo',
      'Live Copilot no painel: o plano vem com 40 horas de live',
    ],
  },
  {
    id: 'business',
    name: 'Business',
    price: 249.9,
    annual: { price: 2499.9, credits: '41.760 créditos no ano' },
    tagline: 'Para times e agências',
    perks: [
      '4.060 créditos/mês',
      'Tudo do Pro',
      'Live Copilot: o plano vem com 60 horas de live',
      'Envio automático: a IA responde no chat da live (exclusivo)',
      'Coleta de dados automatizada',
      'Onboarding dedicado',
      'Suporte prioritário',
    ],
  },
];

/**
 * Bloco do Live Copilot na landing. Sem preço de propósito: o preço mora nos
 * cards de plano e na FAQ; aqui é o que ele faz. Rótulos neutros — nunca o
 * nome do fornecedor ou do modelo de IA em texto de tela.
 */
export const LIVE_COPILOT = {
  eyebrow: 'LIVE COPILOT',
  title: 'Um copiloto lendo o chat da sua live',
  subtitle:
    'A IA acompanha o chat em tempo real e sugere a resposta certa com o preço e o estoque da sua própria base — você só copia ou fala. No Business, ela responde sozinha.',
  bullets: [
    { title: 'Respostas com a sua base', desc: 'Preço, estoque, frete e objeções vêm dos seus produtos e da sua live gravada — não de um texto genérico.' },
    { title: 'Envio automático', desc: 'No plano Business, a IA responde direto no chat da live, sem você tirar a mão do produto.' },
    { title: 'Detector de aviso do TikTok', desc: 'Quando a plataforma sinaliza a transmissão, o copiloto avisa na hora para você ajustar antes de virar bloqueio.' },
    { title: 'Fixar produto', desc: 'Fixe o produto em destaque e as respostas passam a puxar o link e o preço dele automaticamente.' },
  ],
};

export const brl = (v: number) =>
  v === 0 ? 'R$ 0' : `R$ ${v.toFixed(2).replace('.', ',')}`;
