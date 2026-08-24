import {
  AutoFixHighRounded,
  CheckRounded,
  CloseRounded,
  ExpandMoreRounded,
  FavoriteRounded,
  GroupsRounded,
  InsightsRounded,
  LiveTvRounded,
  LocalFireDepartmentRounded,
  OndemandVideoRounded,
  RocketLaunchRounded,
  ArrowForwardRounded,
  StarRounded,
  TrendingUpRounded,
} from '@mui/icons-material';
import {
  Avatar,
  Box,
  Button,
  Chip,
  Collapse,
  Container,
  Grid,
  Stack,
  Typography,
} from '@mui/material';
import { ReactNode, useState } from 'react';
import { Link as RouterLink } from 'react-router-dom';
import { COMPARISON, FAQ, FEATURES, HIGHLIGHTS, LIVE_COPILOT, NICHES, PRICING, STEPS, TESTIMONIALS, brl } from './data';
import { BrowserFrame, Reveal, SectionHeading, cyan, cyanDeep, glass, glowCard, gradientText, ink, inkSoft, line, lineStrong, page, pageNarrow, red, textDim, textFaint, textMain } from './theme';

/* ---------------------------------------------------------------- marquee */

export function NichesMarquee() {
  return (
    <Box sx={{ borderTop: `1px solid ${line}`, borderBottom: `1px solid ${line}`, py: 2.25, overflow: 'hidden', position: 'relative', bgcolor: inkSoft }}>
      <Box
        sx={{
          display: 'flex', gap: 5, width: 'max-content',
          animation: 'lpMarquee 34s linear infinite',
          '&:hover': { animationPlayState: 'paused' },
        }}
      >
        {[...NICHES, ...NICHES].map((n, i) => (
          <Stack key={`${n}-${i}`} direction="row" spacing={1} alignItems="center" sx={{ opacity: 0.55 }}>
            <LocalFireDepartmentRounded sx={{ fontSize: 15, color: red }} />
            <Typography fontSize={14} fontWeight={700} whiteSpace="nowrap" letterSpacing="0.04em">
              {n}
            </Typography>
          </Stack>
        ))}
      </Box>
      <Box aria-hidden sx={{ position: 'absolute', inset: 0, pointerEvents: 'none', background: `linear-gradient(90deg, ${inkSoft}, transparent 12%, transparent 88%, ${inkSoft})` }} />
    </Box>
  );
}

/* --------------------------------------------------------------- features */

function FeatureCard({ icon, tag, title, desc, big = false }: { icon: ReactNode; tag: string; title: string; desc: string; big?: boolean }) {
  return (
    <Box
      sx={{
        ...glowCard,
        p: big ? { xs: 3.5, md: 4.5 } : 3.25,
        height: '100%',
        '&:hover': { ...glowCard['&:hover'], '& .lp-glow': { opacity: 1 }, '& .lp-icon': { transform: 'scale(1.08) rotate(-4deg)' } },
      }}
    >
      <Box
        className="lp-glow"
        aria-hidden
        sx={{
          position: 'absolute', top: -60, right: -60, width: big ? 260 : 160, height: big ? 260 : 160, borderRadius: '50%',
          background: `radial-gradient(circle, ${red}2e, transparent 70%)`,
          opacity: big ? 0.6 : 0, transition: 'opacity .3s ease', pointerEvents: 'none',
        }}
      />
      <Stack direction="row" alignItems="center" justifyContent="space-between" mb={2.5}>
        <Box
          className="lp-icon"
          sx={{
            width: big ? 54 : 44, height: big ? 54 : 44, borderRadius: 3, display: 'grid', placeItems: 'center',
            background: `linear-gradient(135deg, ${red}24, ${cyan}3d)`, color: textMain,
            transition: 'transform .25s ease',
          }}
        >
          {icon}
        </Box>
        <Chip size="small" label={tag} sx={{ bgcolor: 'rgba(11,12,18,0.05)', color: textDim, fontWeight: 700, height: 22, fontSize: 11 }} />
      </Stack>
      <Typography fontWeight={700} fontSize={big ? { xs: 20, md: 22 } : 17} mb={1} letterSpacing="-0.01em" sx={{ overflowWrap: 'anywhere' }}>{title}</Typography>
      <Typography fontSize={big ? 15.5 : 14.5} color={textDim} lineHeight={1.65}>{desc}</Typography>
    </Box>
  );
}

export function Features() {
  return (
    <Container id="recursos" maxWidth={false} sx={{ ...page, py: { xs: 9, md: 13 }, scrollMarginTop: 88 }}>
      <Reveal>
        <SectionHeading
          eyebrow="TUDO EM UM SÓ LUGAR"
          title={<>Da descoberta ao <Box component="span" sx={gradientText}>roteiro pronto</Box></>}
          subtitle="Cada etapa do seu fluxo de trabalho num único painel — sem planilha, sem trocar de aba, sem achismo."
        />
      </Reveal>
      <Grid container spacing={3}>
        {HIGHLIGHTS.map((h, i) => (
          <Grid item xs={12} md={6} key={h.title}>
            <Reveal delay={i * 120}>
              <FeatureCard {...h} big />
            </Reveal>
          </Grid>
        ))}
        {FEATURES.map((f, i) => (
          <Grid item xs={12} sm={6} md={3} key={f.title}>
            <Reveal delay={(i % 4) * 100}>
              <FeatureCard {...f} />
            </Reveal>
          </Grid>
        ))}
      </Grid>
    </Container>
  );
}

/* ----------------------------------------------------------- live copilot */

/**
 * O Live Copilot ganha um bloco próprio, e não um card a mais no bento: é o
 * único recurso que age DURANTE a venda (os outros preparam o criativo antes),
 * e diluído entre sete cards ele lia como "mais uma feature de IA". Sem preço
 * aqui — o preço mora nos planos e na FAQ.
 */
export function LiveCopilot() {
  return (
    <Container id="live-copilot" maxWidth={false} sx={{ ...page, py: { xs: 9, md: 13 }, scrollMarginTop: 88 }}>
      <Reveal>
        <SectionHeading
          eyebrow={LIVE_COPILOT.eyebrow}
          title={<>Venda ao vivo com <Box component="span" sx={gradientText}>a IA no seu chat</Box></>}
          subtitle={LIVE_COPILOT.subtitle}
        />
      </Reveal>
      <Grid container spacing={3}>
        {LIVE_COPILOT.bullets.map((b, i) => (
          <Grid item xs={12} sm={6} md={3} key={b.title}>
            <Reveal delay={i * 100}>
              <FeatureCard icon={<LiveTvRounded />} tag="Ao vivo" title={b.title} desc={b.desc} />
            </Reveal>
          </Grid>
        ))}
      </Grid>
    </Container>
  );
}

/* --------------------------------------------------------------- showcase */

const TABS = [
  { id: 'produtos', label: 'Produtos', icon: <TrendingUpRounded sx={{ fontSize: 18 }} /> },
  { id: 'videos', label: 'Vídeos', icon: <OndemandVideoRounded sx={{ fontSize: 18 }} /> },
  { id: 'criadores', label: 'Criadores', icon: <GroupsRounded sx={{ fontSize: 18 }} /> },
  { id: 'tendencias', label: 'Tendências', icon: <InsightsRounded sx={{ fontSize: 18 }} /> },
  { id: 'prompts', label: 'Estúdio IA', icon: <AutoFixHighRounded sx={{ fontSize: 18 }} /> },
] as const;

type TabId = (typeof TABS)[number]['id'];

/** Capturas reais do app — geradas por frontend/scripts/capture-screens.mjs. */
const PANELS: Record<TabId, { title: string; desc: string; bullets: string[]; img: string; route: string }> = {
  produtos: {
    title: 'Ranking diário de produtos',
    desc: 'Ordene por vendas, faturamento ou preço e filtre pelo nicho em que você já publica.',
    bullets: ['Vendas e faturamento reais', 'Nota do radar por produto', 'Janelas de 7, 30 e 90 dias'],
    img: '/screens/produtos.jpg',
    route: 'pikpokviral.com.br/produtos',
  },
  videos: {
    title: 'Os vídeos que realmente venderam',
    desc: 'Veja o criativo que puxou as vendas do produto e leia a transcrição para entender o gancho.',
    bullets: ['Views, curtidas e faturamento', 'Transcrição do vídeo', 'Link direto para o produto'],
    img: '/screens/videos.jpg',
    route: 'pikpokviral.com.br/videos',
  },
  criadores: {
    title: 'Radar de criadores por nicho',
    desc: 'Monte a lista de parceiros com quem faz sentido falar — antes que a concorrência chegue neles.',
    bullets: ['Ranking por GMV', 'Seguidores e vendas em 30 dias', 'Filtro por categoria'],
    img: '/screens/criadores.jpg',
    route: 'pikpokviral.com.br/criadores',
  },
  tendencias: {
    title: 'O que está subindo agora',
    desc: 'Categorias, hashtags e produtos em ascensão comparando os últimos 7 dias com os 7 anteriores.',
    bullets: ['Hashtags em alta no Brasil', 'Categorias em movimento', 'Produtos em ascensão'],
    img: '/screens/tendencias.jpg',
    route: 'pikpokviral.com.br/tendencias',
  },
  prompts: {
    title: 'Do produto ao criativo, com IA',
    desc: 'Roteiro, análise de viral e um cofre de prompts prontos de vídeo e imagem — é só preencher e usar.',
    bullets: ['Prompts testados de vídeo e imagem', 'Roteiro gerado por IA', 'Geração de imagem e vídeo'],
    img: '/screens/prompts.jpg',
    route: 'pikpokviral.com.br/prompts',
  },
};

export function Showcase() {
  const [tab, setTab] = useState<TabId>('produtos');
  const panel = PANELS[tab];

  return (
    <Box sx={{ bgcolor: inkSoft, borderTop: `1px solid ${line}`, borderBottom: `1px solid ${line}` }}>
      <Container maxWidth={false} sx={{ ...page, py: { xs: 9, md: 12 } }}>
        <Reveal>
          <SectionHeading
            eyebrow="POR DENTRO DA PLATAFORMA"
            title="Veja o PikPok trabalhando"
            subtitle="Telas reais do produto, com os dados que o radar coletou. Clique para navegar entre elas."
          />
        </Reveal>

        <Reveal>
          <Stack direction="row" spacing={1} justifyContent="center" flexWrap="wrap" useFlexGap mb={4}>
            {TABS.map((t) => {
              const active = t.id === tab;
              return (
                <Button
                  key={t.id}
                  onClick={() => setTab(t.id)}
                  startIcon={t.icon}
                  sx={{
                    borderRadius: 999, px: 2.25, py: 1, fontWeight: 700, fontSize: 14,
                    color: active ? red : textDim,
                    border: `1px solid ${active ? `${red}66` : line}`,
                    bgcolor: active ? `${red}1f` : 'transparent',
                    transition: 'all .2s ease',
                    '&:hover': { color: textMain, borderColor: lineStrong },
                  }}
                >
                  {t.label}
                </Button>
              );
            })}
          </Stack>
        </Reveal>

        <Reveal>
          <Grid container spacing={{ xs: 4, lg: 6 }} alignItems="center">
            <Grid item xs={12} md={5} lg={4}>
              <Typography fontSize={{ xs: 24, md: 28 }} fontWeight={800} letterSpacing="-0.02em">
                {panel.title}
              </Typography>
              <Typography color={textDim} fontSize={16} mt={1.5} lineHeight={1.7}>
                {panel.desc}
              </Typography>
              <Stack spacing={1.25} mt={3}>
                {panel.bullets.map((b) => (
                  <Stack key={b} direction="row" spacing={1.25} alignItems="center">
                    <Box sx={{ width: 20, height: 20, borderRadius: '50%', display: 'grid', placeItems: 'center', bgcolor: `${cyan}33` }}>
                      <CheckRounded sx={{ fontSize: 13, color: cyanDeep }} />
                    </Box>
                    <Typography fontSize={14.5}>{b}</Typography>
                  </Stack>
                ))}
              </Stack>
            </Grid>
            <Grid item xs={12} md={7} lg={8}>
              <Box key={tab} sx={{ animation: 'lpFadeUp .45s ease both' }}>
                <BrowserFrame src={panel.img} alt={`Tela de ${panel.title} no PikPok`} caption={panel.route} />
              </Box>
            </Grid>
          </Grid>
        </Reveal>
      </Container>
    </Box>
  );
}

/* ----------------------------------------------------------- how it works */

export function HowItWorks() {
  return (
    <Box id="como-funciona" sx={{ position: 'relative', overflow: 'hidden', scrollMarginTop: 72 }}>
      <Box aria-hidden sx={{ position: 'absolute', bottom: -160, left: '40%', width: 420, height: 420, borderRadius: '50%', filter: 'blur(130px)', background: `${red}1c`, pointerEvents: 'none' }} />
      <Container maxWidth={false} sx={{ ...page, py: { xs: 9, md: 12 } }}>
        <Reveal>
          <SectionHeading
            eyebrow="COMO FUNCIONA"
            title="Três passos entre o dado e a venda"
            subtitle="Menos de dez minutos entre abrir a plataforma e ter um roteiro pronto para gravar."
          />
        </Reveal>
        <Grid container spacing={4}>
          {STEPS.map((s, i) => (
            <Grid item xs={12} md={4} key={s.n}>
              <Reveal delay={i * 150}>
                <Box
                  sx={{
                    ...glass, p: { xs: 2.75, md: 3.5 }, height: '100%', position: 'relative',
                    transition: 'border-color .25s ease, transform .25s ease',
                    '&:hover': { borderColor: `${cyanDeep}55`, transform: 'translateY(-4px)' },
                  }}
                >
                  <Typography sx={{ ...gradientText, fontSize: 44, fontWeight: 800, lineHeight: 1 }}>{s.n}</Typography>
                  <Typography fontWeight={700} fontSize={20} mt={1.5}>{s.title}</Typography>
                  <Typography color={textDim} fontSize={15} mt={1} lineHeight={1.65}>{s.desc}</Typography>
                  <Stack spacing={1} mt={2.5}>
                    {s.bullets.map((b) => (
                      <Stack key={b} direction="row" spacing={1} alignItems="center">
                        <CheckRounded sx={{ fontSize: 15, color: cyanDeep }} />
                        <Typography fontSize={13.5} color={textDim}>{b}</Typography>
                      </Stack>
                    ))}
                  </Stack>
                </Box>
              </Reveal>
            </Grid>
          ))}
        </Grid>
      </Container>
    </Box>
  );
}

/* ------------------------------------------------------------- comparison */

export function Comparison() {
  return (
    <Box sx={{ bgcolor: inkSoft, borderTop: `1px solid ${line}`, borderBottom: `1px solid ${line}` }}>
      <Container maxWidth={false} sx={{ ...pageNarrow, py: { xs: 9, md: 12 } }}>
        <Reveal>
          <SectionHeading
            eyebrow="ANTES E DEPOIS"
            title="A diferença de trabalhar com dado"
            subtitle="O mesmo esforço, direcionado ao produto certo, no momento certo."
          />
        </Reveal>
        <Reveal>
          <Box sx={{ ...glass, overflow: 'hidden' }}>
            <Grid container sx={{ borderBottom: `1px solid ${line}`, bgcolor: 'rgba(11,12,18,0.03)' }}>
              <Grid item xs={12} sm={4} sx={{ p: 2, display: { xs: 'none', sm: 'block' } }}>
                <Typography fontSize={12} fontWeight={800} letterSpacing="0.1em" color={textFaint}>ETAPA</Typography>
              </Grid>
              <Grid item xs={6} sm={4} sx={{ p: 2 }}>
                <Typography fontSize={12} fontWeight={800} letterSpacing="0.1em" color={textFaint}>SEM PIKPOK</Typography>
              </Grid>
              <Grid item xs={6} sm={4} sx={{ p: 2 }}>
                <Typography fontSize={12} fontWeight={800} letterSpacing="0.1em" color={cyanDeep}>COM PIKPOK</Typography>
              </Grid>
            </Grid>
            {COMPARISON.map((row, i) => (
              <Grid
                container
                key={row.label}
                sx={{ borderBottom: i === COMPARISON.length - 1 ? 'none' : `1px solid ${line}`, alignItems: 'stretch' }}
              >
                <Grid item xs={12} sm={4} sx={{ p: 2 }}>
                  <Typography fontSize={14.5} fontWeight={700} sx={{ overflowWrap: 'anywhere' }}>{row.label}</Typography>
                </Grid>
                <Grid item xs={6} sm={4} sx={{ p: { xs: 1.5, sm: 2 }, minWidth: 0 }}>
                  <Stack direction="row" spacing={1} alignItems="flex-start">
                    <CloseRounded sx={{ fontSize: 16, color: 'rgba(11,12,18,0.28)', mt: '2px', flexShrink: 0 }} />
                    <Typography fontSize={13.5} color={textFaint} sx={{ minWidth: 0, overflowWrap: 'anywhere' }}>{row.without}</Typography>
                  </Stack>
                </Grid>
                <Grid item xs={6} sm={4} sx={{ p: { xs: 1.5, sm: 2 }, bgcolor: `${cyan}1c`, minWidth: 0 }}>
                  <Stack direction="row" spacing={1} alignItems="flex-start">
                    <CheckRounded sx={{ fontSize: 16, color: cyanDeep, mt: '2px', flexShrink: 0 }} />
                    <Typography fontSize={13.5} sx={{ minWidth: 0, overflowWrap: 'anywhere' }}>{row.with}</Typography>
                  </Stack>
                </Grid>
              </Grid>
            ))}
          </Box>
        </Reveal>
      </Container>
    </Box>
  );
}

/* ----------------------------------------------------------- testimonials */

export function Testimonials() {
  return (
    <Container id="depoimentos" maxWidth={false} sx={{ ...page, py: { xs: 9, md: 12 }, scrollMarginTop: 88 }}>
      <Reveal>
        <SectionHeading
          eyebrow="QUEM JÁ USA"
          title={<>Feito para quem vive de <Box component="span" sx={gradientText}>vender no TikTok</Box></>}
          subtitle="Afiliados, sellers e agências que trocaram o achismo pelo ranking diário."
        />
      </Reveal>
      <Grid container spacing={3}>
        {TESTIMONIALS.map((t, i) => (
          <Grid item xs={12} sm={6} md={3} key={t.name}>
            <Reveal delay={(i % 4) * 100}>
              <Box sx={{ ...glowCard, p: 3, height: '100%', display: 'flex', flexDirection: 'column' }}>
                <Stack direction="row" spacing={0.25} mb={1.5}>
                  {Array.from({ length: 5 }).map((_, s) => (
                    <StarRounded key={s} sx={{ fontSize: 16, color: '#ffc94d' }} />
                  ))}
                </Stack>
                <Typography fontSize={14.5} lineHeight={1.7} flex={1}>“{t.quote}”</Typography>
                <Chip
                  size="small"
                  icon={<TrendingUpRounded sx={{ fontSize: 14, color: `${cyanDeep} !important` }} />}
                  label={t.metric}
                  sx={{ mt: 2, alignSelf: 'flex-start', bgcolor: 'rgba(10,156,151,0.12)', color: cyanDeep, fontWeight: 700 }}
                />
                <Stack direction="row" spacing={1.5} alignItems="center" mt={2.5} pt={2.5} borderTop={`1px solid ${line}`}>
                  <Avatar sx={{ width: 36, height: 36, fontSize: 13, fontWeight: 800, background: `linear-gradient(135deg, ${red}, ${cyanDeep})` }}>
                    {t.initials}
                  </Avatar>
                  <Box minWidth={0}>
                    <Typography fontSize={13.5} fontWeight={700} noWrap>{t.name}</Typography>
                    <Typography fontSize={12} color={textDim} noWrap>{t.role}</Typography>
                  </Box>
                </Stack>
              </Box>
            </Reveal>
          </Grid>
        ))}
      </Grid>
    </Container>
  );
}

/* ---------------------------------------------------------------- pricing */

export function Pricing() {
  return (
    <Box id="planos" sx={{ bgcolor: inkSoft, borderTop: `1px solid ${line}`, borderBottom: `1px solid ${line}`, scrollMarginTop: 72 }}>
      <Container maxWidth={false} sx={{ ...page, py: { xs: 9, md: 12 } }}>
        <Reveal>
          <SectionHeading
            eyebrow="PLANOS"
            title="Escolha o plano do seu ritmo de produção"
            subtitle="Todo plano inclui a descoberta completa. Os créditos cobrem as ações com IA — roteiro, análise, transcrição, imagem e vídeo."
          />
        </Reveal>
        <Grid container spacing={3} alignItems="stretch">
          {PRICING.map((p, i) => (
            <Grid item xs={12} sm={6} md={4} key={p.id}>
              <Reveal delay={i * 100} full>
                <Box
                  sx={{
                    ...glass, p: 3.25, height: '100%', display: 'flex', flexDirection: 'column',
                    position: 'relative', overflow: 'hidden',
                    borderColor: p.highlight ? `${red}66` : line,
                    boxShadow: p.highlight ? `0 24px 60px ${red}22` : 'none',
                    transition: 'transform .25s ease, border-color .25s ease',
                    '&:hover': { transform: 'translateY(-6px)', borderColor: p.highlight ? `${red}99` : lineStrong },
                  }}
                >
                  {(p.offerLabel || p.highlight) && (
                    <Chip
                      size="small"
                      label={p.offerLabel ?? 'Mais popular'}
                      sx={{
                        position: 'absolute', top: 14, right: 14, color: '#fff',
                        fontWeight: 800, height: 22, fontSize: 11,
                        background: p.offerLabel
                          ? 'linear-gradient(135deg, #f59e0b, #ef4444)'
                          : red,
                      }}
                    />
                  )}
                  {/* Reserva espaço à direita para o chip absoluto não cobrir o nome do plano */}
                  <Typography fontSize={15} fontWeight={800} letterSpacing="0.02em" sx={{ pr: (p.offerLabel || p.highlight) ? 12 : 0 }}>{p.name}</Typography>
                  <Typography fontSize={12.5} color={textFaint} mb={2}>{p.tagline}</Typography>
                  <Stack direction="row" alignItems="baseline" spacing={0.75} flexWrap="wrap" useFlexGap>
                    {/* Preço de tabela riscado quando há oferta em vigor */}
                    {p.listPrice && (
                      <Typography fontSize={17} color={textFaint} sx={{ textDecoration: 'line-through' }}>
                        {brl(p.listPrice)}
                      </Typography>
                    )}
                    <Typography fontSize={{ xs: 30, md: 34 }} fontWeight={800} letterSpacing="-0.03em" whiteSpace="nowrap">{brl(p.price)}</Typography>
                    {p.price > 0 && <Typography fontSize={13} color={textDim}>/mês</Typography>}
                  </Stack>
                  {p.annual && (
                    <Typography fontSize={12.5} color={cyanDeep} fontWeight={700} mt={0.75}>
                      ou {brl(p.annual.price)}/ano · {p.annual.credits}
                    </Typography>
                  )}
                  <Stack spacing={1.25} mt={3} flex={1}>
                    {p.perks.map((perk) => (
                      <Stack key={perk} direction="row" spacing={1.25} alignItems="flex-start">
                        <CheckRounded sx={{ fontSize: 16, color: cyanDeep, mt: '2px' }} />
                        <Typography fontSize={13.5} color={textDim} lineHeight={1.5}>{perk}</Typography>
                      </Stack>
                    ))}
                  </Stack>
                  <Button
                    component={RouterLink}
                    to="/login"
                    fullWidth
                    variant={p.highlight ? 'contained' : 'outlined'}
                    sx={{
                      mt: 3, py: 1.15, fontWeight: 700,
                      ...(p.highlight
                        ? { bgcolor: red, '&:hover': { bgcolor: '#e0264c' } }
                        : { borderColor: lineStrong, color: textMain, '&:hover': { borderColor: textMain, bgcolor: 'rgba(11,12,18,0.04)' } }),
                    }}
                  >
                    {'Assinar'}
                  </Button>
                </Box>
              </Reveal>
            </Grid>
          ))}
        </Grid>
        <Reveal>
          <Stack direction="row" spacing={1} alignItems="flex-start" justifyContent="center" mt={4} color={textFaint} sx={{ maxWidth: 560, mx: 'auto' }}>
            <FavoriteRounded sx={{ fontSize: 15, color: red, flexShrink: 0, mt: '2px' }} />
            <Typography fontSize={13.5} sx={{ minWidth: 0, textAlign: { xs: 'left', sm: 'center' } }}>
              Sem fidelidade · cancele quando quiser · pacotes de crédito avulsos disponíveis
            </Typography>
          </Stack>
        </Reveal>
      </Container>
    </Box>
  );
}

/* -------------------------------------------------------------------- faq */

/**
 * Acordeão próprio: o `Accordion` do MUI herda o Paper do tema claro do app
 * e briga com a paleta dark da landing.
 */
function FaqItem({ q, a, open, onToggle }: { q: string; a: string; open: boolean; onToggle: () => void }) {
  return (
    <Box
      sx={{
        ...glass,
        borderRadius: 3,
        overflow: 'hidden',
        borderColor: open ? `${cyanDeep}55` : line,
        bgcolor: open ? 'rgba(10,156,151,0.05)' : undefined,
        transition: 'border-color .25s ease, background-color .25s ease',
        '&:hover': { borderColor: open ? `${cyanDeep}88` : lineStrong },
      }}
    >
      <Box
        component="button"
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        sx={{
          width: '100%', display: 'flex', alignItems: 'center', gap: 2, textAlign: 'left',
          px: { xs: 2.25, md: 3 }, py: 2.25,
          bgcolor: 'transparent', border: 'none', color: 'inherit', font: 'inherit', cursor: 'pointer',
        }}
      >
        <Typography flex={1} fontSize={{ xs: 15, md: 16.5 }} fontWeight={700} lineHeight={1.4}>
          {q}
        </Typography>
        <Box
          aria-hidden
          sx={{
            flexShrink: 0, width: 28, height: 28, borderRadius: '50%', display: 'grid', placeItems: 'center',
            bgcolor: open ? `${cyan}33` : 'rgba(11,12,18,0.06)',
            transition: 'background-color .25s ease',
          }}
        >
          <ExpandMoreRounded
            sx={{
              fontSize: 19, color: open ? cyanDeep : textDim,
              transform: open ? 'rotate(180deg)' : 'none',
              transition: 'transform .25s ease, color .25s ease',
            }}
          />
        </Box>
      </Box>
      <Collapse in={open} timeout={260} unmountOnExit>
        <Typography
          fontSize={14.5}
          color={textDim}
          lineHeight={1.75}
          sx={{ px: { xs: 2.25, md: 3 }, pb: 2.75, pr: { md: 7 } }}
        >
          {a}
        </Typography>
      </Collapse>
    </Box>
  );
}

export function Faq() {
  const [open, setOpen] = useState<string | null>(FAQ[0].q);

  return (
    <Box id="faq" sx={{ scrollMarginTop: 72, position: 'relative', overflow: 'hidden' }}>
      <Box aria-hidden sx={{ position: 'absolute', top: '20%', left: -180, width: 420, height: 420, borderRadius: '50%', filter: 'blur(140px)', background: `${cyan}2e`, pointerEvents: 'none' }} />
      <Container maxWidth={false} sx={{ ...page, py: { xs: 9, md: 12 } }}>
        <Grid container spacing={{ xs: 5, md: 8 }}>
          <Grid item xs={12} md={4}>
            <Reveal>
              <Box sx={{ position: { md: 'sticky' }, top: { md: 110 } }}>
                <Typography sx={{ color: cyanDeep, fontWeight: 700, letterSpacing: '0.14em', fontSize: 13, overflowWrap: 'anywhere' }}>
                  DÚVIDAS FREQUENTES
                </Typography>
                <Typography
                  component="h2"
                  sx={{ fontSize: { xs: 28, sm: 30, md: 40 }, fontWeight: 800, letterSpacing: '-0.025em', mt: 1.5, lineHeight: 1.15, overflowWrap: 'anywhere' }}
                >
                  Perguntas que <Box component="span" sx={gradientText}>todo mundo faz</Box>
                </Typography>
                <Typography color={textDim} fontSize={16} mt={2} lineHeight={1.7}>
                  Não achou o que procurava? A gente responde direto no painel, assim que você criar sua conta.
                </Typography>
                <Button
                  component={RouterLink}
                  to="/login"
                  endIcon={<ArrowForwardRounded />}
                  sx={{
                    mt: 3, ...glass, borderRadius: 3, color: textMain, px: 2.5, py: 1.1, fontWeight: 700,
                    '&:hover': { borderColor: `${cyanDeep}66` },
                  }}
                >
                  Falar com a gente
                </Button>
              </Box>
            </Reveal>
          </Grid>
          <Grid item xs={12} md={8}>
            <Stack spacing={1.5}>
              {FAQ.map((item, i) => (
                <Reveal key={item.q} delay={Math.min(i, 3) * 80}>
                  <FaqItem
                    q={item.q}
                    a={item.a}
                    open={open === item.q}
                    onToggle={() => setOpen((cur) => (cur === item.q ? null : item.q))}
                  />
                </Reveal>
              ))}
            </Stack>
          </Grid>
        </Grid>
      </Container>
    </Box>
  );
}

/* -------------------------------------------------------------- final cta */

export function FinalCta() {
  return (
    <Container maxWidth={false} sx={{ ...page, py: { xs: 9, md: 13 } }}>
      <Reveal>
        <Box
          sx={{
            ...glass,
            position: 'relative', overflow: 'hidden', textAlign: 'center',
            px: { xs: 3, md: 8, lg: 12 }, py: { xs: 7, md: 10, lg: 12 },
            borderColor: `${red}33`,
          }}
        >
          <Box aria-hidden sx={{ position: 'absolute', top: -160, left: '15%', width: 380, height: 380, borderRadius: '50%', filter: 'blur(120px)', background: `${red}2e`, animation: 'lpBlob 18s ease-in-out infinite', pointerEvents: 'none' }} />
          <Box aria-hidden sx={{ position: 'absolute', bottom: -180, right: '10%', width: 360, height: 360, borderRadius: '50%', filter: 'blur(120px)', background: `${cyan}3d`, animation: 'lpBlob 22s ease-in-out infinite reverse', pointerEvents: 'none' }} />
          <Box position="relative">
            <Typography sx={{ fontSize: { xs: 28, sm: 30, md: 46 }, fontWeight: 800, letterSpacing: '-0.03em', lineHeight: 1.1, overflowWrap: 'anywhere' }}>
              Pronto para vender <Box component="span" sx={gradientText}>antes da tendência</Box>?
            </Typography>
            <Typography color={textDim} fontSize={{ xs: 15.5, md: 17.5 }} mt={2.5} maxWidth={560} mx="auto" lineHeight={1.65}>
              Crie sua conta em menos de um minuto, ganhe 25 créditos de boas-vindas e 10 minutos de
              Live Copilot de cortesia, e descubra hoje mesmo o que já está bombando no seu nicho.
            </Typography>
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} justifyContent="center" alignItems={{ xs: 'stretch', sm: 'center' }} mt={4.5} sx={{ maxWidth: { xs: 360, sm: 'none' }, mx: 'auto' }}>
              <Button
                component={RouterLink}
                to="/login"
                size="large"
                variant="contained"
                startIcon={<RocketLaunchRounded />}
                endIcon={<ArrowForwardRounded sx={{ transition: 'transform .2s ease' }} />}
                sx={{
                  bgcolor: red, px: 5, py: 1.6, fontSize: 16,
                  boxShadow: `0 8px 30px ${red}66`, position: 'relative', overflow: 'hidden',
                  transition: 'transform .2s ease, box-shadow .2s ease',
                  '&:hover': {
                    bgcolor: '#e0264c', transform: 'translateY(-2px)', boxShadow: `0 16px 44px ${red}80`,
                    '& .MuiButton-endIcon svg': { transform: 'translateX(4px)' },
                  },
                  '&:active': { transform: 'translateY(0) scale(0.97)' },
                  '&::after': {
                    content: '""', position: 'absolute', top: 0, bottom: 0, width: '40%',
                    background: 'linear-gradient(90deg, transparent, rgba(255,255,255,0.35), transparent)',
                    animation: 'lpShine 3.2s ease-in-out infinite',
                  },
                }}
              >
                Assinar agora
              </Button>
              <Button
                href="#planos"
                size="large"
                sx={{
                  ...glass, color: textMain, px: 4, py: 1.6, fontSize: 16,
                  '&:hover': { borderColor: `${cyanDeep}66` },
                }}
              >
                Ver planos
              </Button>
            </Stack>
            <Typography fontSize={13} color={textFaint} mt={3}>
              Sem fidelidade · cancele quando quiser
            </Typography>
          </Box>
        </Box>
      </Reveal>
    </Container>
  );
}

/* ----------------------------------------------------------------- footer */

const FOOTER_COLS = [
  { title: 'Produto', links: [['Recursos', '#recursos'], ['Como funciona', '#como-funciona'], ['Planos', '#planos'], ['FAQ', '#faq']] },
  { title: 'Plataforma', links: [['Entrar', '/login'], ['Criar conta', '/login'], ['Academy', '/login'], ['Estúdio IA', '/login']] },
];

export function Footer() {
  return (
    <Box component="footer" sx={{ borderTop: `1px solid ${line}`, bgcolor: ink }}>
      <Container maxWidth={false} sx={{ ...page, pt: { xs: 5, md: 7 }, pb: 4 }}>
        <Grid container spacing={{ xs: 4, md: 5 }}>
          <Grid item xs={12} md={5}>
            <Stack direction="row" spacing={1.25} alignItems="center" mb={2}>
              <Box component="img" src="/icon-192.png" alt="PikPok" sx={{ width: 32, height: 32, borderRadius: 1.5 }} />
              <Typography fontWeight={800} fontSize={19}>
                Pik<Box component="span" sx={{ color: red }}>Pok</Box>
              </Typography>
            </Stack>
            <Typography fontSize={14} color={textDim} maxWidth={340} lineHeight={1.7}>
              Inteligência de produtos, vídeos e criadores do TikTok Shop — com IA para transformar
              dado em roteiro pronto para gravar.
            </Typography>
          </Grid>
          {FOOTER_COLS.map((col) => (
            <Grid item xs={6} md={2} key={col.title}>
              <Typography fontSize={12.5} fontWeight={800} letterSpacing="0.1em" color={textFaint} mb={2}>
                {col.title.toUpperCase()}
              </Typography>
              <Stack spacing={1.25}>
                {col.links.map(([label, href]) => {
                  const internal = href.startsWith('/');
                  return (
                    <Box
                      key={label}
                      component={internal ? RouterLink : 'a'}
                      {...(internal ? { to: href } : { href })}
                      sx={{ fontSize: 14, color: textDim, textDecoration: 'none', '&:hover': { color: textMain } }}
                    >
                      {label}
                    </Box>
                  );
                })}
              </Stack>
            </Grid>
          ))}
          <Grid item xs={12} md={3}>
            <Typography fontSize={12.5} fontWeight={800} letterSpacing="0.1em" color={textFaint} mb={2}>
              COMEÇAR
            </Typography>
            <Typography fontSize={14} color={textDim} mb={2} lineHeight={1.6}>
              Assine e destrave o radar completo. Cancele quando quiser.
            </Typography>
            <Button
              component={RouterLink}
              to="/login"
              variant="contained"
              endIcon={<ArrowForwardRounded />}
              sx={{ bgcolor: red, fontWeight: 700, '&:hover': { bgcolor: '#e0264c' } }}
            >
              Criar conta
            </Button>
          </Grid>
        </Grid>

        <Stack
          direction={{ xs: 'column', sm: 'row' }}
          alignItems="center"
          justifyContent="space-between"
          spacing={1.5}
          mt={6}
          pt={3}
          borderTop={`1px solid ${line}`}
        >
          <Typography fontSize={13} color={textFaint} textAlign={{ xs: 'center', sm: 'left' }}>
            © {new Date().getFullYear()} PikPok — inteligência de produtos para o TikTok Shop
          </Typography>
          <Typography fontSize={13} color={textFaint} textAlign={{ xs: 'center', sm: 'right' }}>
            Não afiliado ao TikTok · dados públicos consolidados
          </Typography>
        </Stack>
      </Container>
    </Box>
  );
}
