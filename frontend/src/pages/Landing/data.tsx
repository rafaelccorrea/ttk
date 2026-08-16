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
    a: 'Ações com IA (roteiro, análise de viral, transcrição, imagem e vídeo) consomem créditos. Todo plano vem com uma cota mensal e você pode comprar pacotes avulsos quando precisar. A descoberta de produtos, vídeos e criadores não consome crédito.',
  },
  {
    q: 'Posso cancelar quando quiser?',
    a: 'Sim. A assinatura é mensal, sem fidelidade, e você cancela pelo próprio painel. O acesso continua válido até o fim do período já pago.',
  },
  {
    q: 'Preciso de cartão para testar?',
    a: 'Não. O plano Free é permanente e você ainda ganha 30 créditos de boas-vindas no cadastro para experimentar as ferramentas de IA.',
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

export const PRICING: PricingPlan[] = [
  {
    id: 'essencial',
    name: 'Essencial',
    price: 39.9,
    annual: { price: 399.9, credits: '4.600 créditos no ano' },
    tagline: 'Para começar a garimpar',
    perks: ['450 créditos/mês', 'Descoberta completa: produtos, vídeos e criadores', 'Roteiros e análises com IA', 'Transcrição de vídeos', 'Imagens com IA'],
  },
  {
    id: 'pro',
    name: 'Pro',
    price: 89.9,
    annual: { price: 899.9, credits: '10.400 créditos no ano' },
    tagline: 'Para quem publica toda semana',
    highlight: true,
    perks: ['1.000 créditos/mês', 'Tudo do Essencial', 'Vídeos com IA', 'Multiplicador de conteúdo'],
  },
  {
    id: 'business',
    name: 'Business',
    price: 249.9,
    tagline: 'Para times e agências',
    perks: ['2.800 créditos/mês', 'Tudo do Pro', 'Coleta de dados automatizada', 'Onboarding dedicado', 'Suporte prioritário'],
  },
];

export const brl = (v: number) =>
  v === 0 ? 'R$ 0' : `R$ ${v.toFixed(2).replace('.', ',')}`;
