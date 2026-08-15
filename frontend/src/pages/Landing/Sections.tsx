import {
  AutoAwesomeRounded,
  AutoFixHighRounded,
  CheckRounded,
  CloseRounded,
  ExpandMoreRounded,
  FavoriteRounded,
  GroupsRounded,
  LocalFireDepartmentRounded,
  OndemandVideoRounded,
  RocketLaunchRounded,
  ArrowForwardRounded,
  StarRounded,
  TrendingUpRounded,
} from '@mui/icons-material';
import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Avatar,
  Box,
  Button,
  Chip,
  Container,
  Grid,
  Stack,
  Typography,
} from '@mui/material';
import { ReactNode, useState } from 'react';
import { Link as RouterLink } from 'react-router-dom';
import { COMPARISON, FAQ, FEATURES, HIGHLIGHTS, NICHES, PRICING, STEPS, TESTIMONIALS, brl } from './data';
import { Reveal, SectionHeading, cyan, glass, glowCard, gradientText, ink, inkSoft, line, lineStrong, red, textDim, textFaint } from './theme';

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
            background: `linear-gradient(135deg, ${red}2e, ${cyan}2e)`, color: '#fff',
            transition: 'transform .25s ease',
          }}
        >
          {icon}
        </Box>
        <Chip size="small" label={tag} sx={{ bgcolor: 'rgba(255,255,255,0.06)', color: textDim, fontWeight: 700, height: 22, fontSize: 11 }} />
      </Stack>
      <Typography fontWeight={700} fontSize={big ? 22 : 17} mb={1} letterSpacing="-0.01em">{title}</Typography>
      <Typography fontSize={big ? 15.5 : 14.5} color={textDim} lineHeight={1.65}>{desc}</Typography>
    </Box>
  );
}

export function Features() {
  return (
    <Container id="recursos" maxWidth="lg" sx={{ py: { xs: 9, md: 13 }, scrollMarginTop: 88 }}>
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

/* --------------------------------------------------------------- showcase */

const TABS = [
  { id: 'produtos', label: 'Produtos', icon: <TrendingUpRounded sx={{ fontSize: 18 }} /> },
  { id: 'videos', label: 'Vídeos', icon: <OndemandVideoRounded sx={{ fontSize: 18 }} /> },
  { id: 'criadores', label: 'Criadores', icon: <GroupsRounded sx={{ fontSize: 18 }} /> },
  { id: 'estudio', label: 'Estúdio IA', icon: <AutoFixHighRounded sx={{ fontSize: 18 }} /> },
] as const;

type TabId = (typeof TABS)[number]['id'];

const PANELS: Record<TabId, { title: string; desc: string; bullets: string[]; body: ReactNode }> = {
  produtos: {
    title: 'Ranking diário de produtos',
    desc: 'Ordene por crescimento, comissão ou receita estimada e filtre pelo nicho em que você já publica.',
    bullets: ['Receita e GMV estimados', 'Comissão e faixa de preço', 'Índice de saturação'],
    body: (
      <Stack spacing={1.25}>
        {[
          ['Mini ring light recarregável', '+312%', 'R$ 84k', '18%'],
          ['Escova alisadora 3 em 1', '+248%', 'R$ 61k', '22%'],
          ['Organizador de maquiagem', '+197%', 'R$ 47k', '15%'],
          ['Garrafa térmica smart', '+154%', 'R$ 39k', '11%'],
        ].map(([name, growth, rev, com]) => (
          <Stack key={name} direction="row" alignItems="center" spacing={1.5} sx={{ ...glass, borderRadius: 3, p: 1.4 }}>
            <Box sx={{ width: 32, height: 32, borderRadius: 2, flexShrink: 0, background: `linear-gradient(135deg, ${red}33, ${cyan}33)` }} />
            <Typography flex={1} minWidth={0} noWrap fontSize={13.5} fontWeight={700}>{name}</Typography>
            <Chip size="small" label={growth} sx={{ bgcolor: 'rgba(37,244,238,0.12)', color: cyan, fontWeight: 700, height: 22 }} />
            <Typography fontSize={13} fontWeight={700} width={62} textAlign="right">{rev}</Typography>
            <Typography fontSize={12} color={textDim} width={44} textAlign="right">{com}</Typography>
          </Stack>
        ))}
      </Stack>
    ),
  },
  videos: {
    title: 'Os vídeos que realmente converteram',
    desc: 'Veja o criativo que puxou as vendas do produto e entenda o gancho, o ritmo e o CTA por trás dele.',
    bullets: ['Views, likes e conversão', 'Transcrição completa', 'Estrutura do gancho'],
    body: (
      <Grid container spacing={1.5}>
        {[
          ['2,4M', 'Testei por 7 dias e…'],
          ['890k', 'Ninguém te conta isso'],
          ['1,1M', 'Por R$ 39 eu não esperava'],
          ['640k', 'Antes x depois real'],
        ].map(([views, hook]) => (
          <Grid item xs={6} key={hook}>
            <Box sx={{ ...glass, borderRadius: 3, p: 1.5, height: '100%' }}>
              <Box
                sx={{
                  position: 'relative', height: 84, borderRadius: 2, mb: 1.25, overflow: 'hidden',
                  background: `linear-gradient(135deg, ${red}2a, ${cyan}22)`,
                  display: 'grid', placeItems: 'center',
                }}
              >
                <OndemandVideoRounded sx={{ color: 'rgba(255,255,255,0.55)' }} />
                <Box
                  aria-hidden
                  sx={{
                    position: 'absolute', left: 0, right: 0, height: 2,
                    background: `linear-gradient(90deg, transparent, ${cyan}, transparent)`,
                    animation: 'lpScan 3.4s linear infinite',
                  }}
                />
              </Box>
              <Typography fontSize={12.5} fontWeight={700} noWrap>“{hook}”</Typography>
              <Typography fontSize={11.5} color={textDim}>{views} views · gancho de 1,8s</Typography>
            </Box>
          </Grid>
        ))}
      </Grid>
    ),
  },
  criadores: {
    title: 'Radar de criadores por nicho',
    desc: 'Monte a lista de parceiros com quem faz sentido falar — antes que a concorrência chegue neles.',
    bullets: ['Filtro por nicho e GMV', 'Engajamento real', 'Histórico de produtos'],
    body: (
      <Stack spacing={1.25}>
        {[
          ['@lala.beauty', 'Beleza', '412k', '8,4%'],
          ['@casa.do.gui', 'Casa', '188k', '11,2%'],
          ['@fit.com.ana', 'Fitness', '96k', '9,7%'],
          ['@gadget.br', 'Gadgets', '271k', '6,9%'],
        ].map(([handle, niche, followers, eng]) => (
          <Stack key={handle} direction="row" alignItems="center" spacing={1.5} sx={{ ...glass, borderRadius: 3, p: 1.4 }}>
            <Avatar sx={{ width: 32, height: 32, fontSize: 13, bgcolor: `${red}33`, color: '#fff' }}>
              {handle[1].toUpperCase()}
            </Avatar>
            <Box flex={1} minWidth={0}>
              <Typography fontSize={13.5} fontWeight={700} noWrap>{handle}</Typography>
              <Typography fontSize={11.5} color={textDim}>{niche} · {followers} seguidores</Typography>
            </Box>
            <Chip size="small" label={`${eng} eng.`} sx={{ bgcolor: 'rgba(37,244,238,0.12)', color: cyan, fontWeight: 700, height: 22 }} />
          </Stack>
        ))}
      </Stack>
    ),
  },
  estudio: {
    title: 'Roteiro pronto para gravar',
    desc: 'A IA lê os virais daquele produto e devolve gancho, corpo e CTA no seu tom — em segundos.',
    bullets: ['Gancho testado', 'Corpo com prova', 'CTA de conversão'],
    body: (
      <Stack spacing={1.5}>
        {[
          ['GANCHO · 0-3s', 'Parei de gastar R$ 200 em ring light quando descobri esse aqui.'],
          ['CORPO · 3-18s', 'Ele carrega por USB, tem 3 tons de luz e prende em qualquer superfície. Gravei esse vídeo com ele.'],
          ['CTA · 18-25s', 'Tá no link amarelo por menos de R$ 40 — corre que o estoque some.'],
        ].map(([label, text], i) => (
          <Box key={label} sx={{ ...glass, borderRadius: 3, p: 1.75, animation: `lpFadeUp .5s ease ${i * 120}ms both` }}>
            <Typography fontSize={11} fontWeight={800} letterSpacing="0.1em" color={cyan}>{label}</Typography>
            <Typography fontSize={14} mt={0.75} lineHeight={1.6}>{text}</Typography>
          </Box>
        ))}
        <Stack direction="row" spacing={1} alignItems="center" color={textFaint}>
          <AutoAwesomeRounded sx={{ fontSize: 15 }} />
          <Typography fontSize={12.5}>gerado em 4,2s · 8 créditos</Typography>
        </Stack>
      </Stack>
    ),
  },
};

export function Showcase() {
  const [tab, setTab] = useState<TabId>('produtos');
  const panel = PANELS[tab];

  return (
    <Box sx={{ bgcolor: inkSoft, borderTop: `1px solid ${line}`, borderBottom: `1px solid ${line}` }}>
      <Container maxWidth="lg" sx={{ py: { xs: 9, md: 12 } }}>
        <Reveal>
          <SectionHeading
            eyebrow="POR DENTRO DA PLATAFORMA"
            title="Veja o PikPok trabalhando"
            subtitle="Quatro telas, um fluxo. Clique para navegar entre elas."
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
                    color: active ? '#fff' : textDim,
                    border: `1px solid ${active ? `${red}66` : line}`,
                    bgcolor: active ? `${red}1f` : 'transparent',
                    transition: 'all .2s ease',
                    '&:hover': { color: '#fff', borderColor: lineStrong },
                  }}
                >
                  {t.label}
                </Button>
              );
            })}
          </Stack>
        </Reveal>

        <Reveal>
          <Grid container spacing={4} alignItems="center">
            <Grid item xs={12} md={5}>
              <Typography fontSize={{ xs: 24, md: 28 }} fontWeight={800} letterSpacing="-0.02em">
                {panel.title}
              </Typography>
              <Typography color={textDim} fontSize={16} mt={1.5} lineHeight={1.7}>
                {panel.desc}
              </Typography>
              <Stack spacing={1.25} mt={3}>
                {panel.bullets.map((b) => (
                  <Stack key={b} direction="row" spacing={1.25} alignItems="center">
                    <Box sx={{ width: 20, height: 20, borderRadius: '50%', display: 'grid', placeItems: 'center', bgcolor: `${cyan}1f` }}>
                      <CheckRounded sx={{ fontSize: 13, color: cyan }} />
                    </Box>
                    <Typography fontSize={14.5}>{b}</Typography>
                  </Stack>
                ))}
              </Stack>
            </Grid>
            <Grid item xs={12} md={7}>
              <Box
                key={tab}
                sx={{
                  ...glass, p: { xs: 2, md: 3 }, boxShadow: '0 30px 80px rgba(0,0,0,0.5)',
                  animation: 'lpFadeUp .45s ease both',
                }}
              >
                {panel.body}
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
      <Container maxWidth="lg" sx={{ py: { xs: 9, md: 12 } }}>
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
                    ...glass, p: 3.5, height: '100%', position: 'relative',
                    transition: 'border-color .25s ease, transform .25s ease',
                    '&:hover': { borderColor: `${cyan}44`, transform: 'translateY(-4px)' },
                  }}
                >
                  <Typography sx={{ ...gradientText, fontSize: 44, fontWeight: 800, lineHeight: 1 }}>{s.n}</Typography>
                  <Typography fontWeight={700} fontSize={20} mt={1.5}>{s.title}</Typography>
                  <Typography color={textDim} fontSize={15} mt={1} lineHeight={1.65}>{s.desc}</Typography>
                  <Stack spacing={1} mt={2.5}>
                    {s.bullets.map((b) => (
                      <Stack key={b} direction="row" spacing={1} alignItems="center">
                        <CheckRounded sx={{ fontSize: 15, color: cyan }} />
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
      <Container maxWidth="md" sx={{ py: { xs: 9, md: 12 } }}>
        <Reveal>
          <SectionHeading
            eyebrow="ANTES E DEPOIS"
            title="A diferença de trabalhar com dado"
            subtitle="O mesmo esforço, direcionado ao produto certo, no momento certo."
          />
        </Reveal>
        <Reveal>
          <Box sx={{ ...glass, overflow: 'hidden' }}>
            <Grid container sx={{ borderBottom: `1px solid ${line}`, bgcolor: 'rgba(255,255,255,0.02)' }}>
              <Grid item xs={12} sm={4} sx={{ p: 2, display: { xs: 'none', sm: 'block' } }}>
                <Typography fontSize={12} fontWeight={800} letterSpacing="0.1em" color={textFaint}>ETAPA</Typography>
              </Grid>
              <Grid item xs={6} sm={4} sx={{ p: 2 }}>
                <Typography fontSize={12} fontWeight={800} letterSpacing="0.1em" color={textFaint}>SEM PIKPOK</Typography>
              </Grid>
              <Grid item xs={6} sm={4} sx={{ p: 2 }}>
                <Typography fontSize={12} fontWeight={800} letterSpacing="0.1em" color={cyan}>COM PIKPOK</Typography>
              </Grid>
            </Grid>
            {COMPARISON.map((row, i) => (
              <Grid
                container
                key={row.label}
                sx={{ borderBottom: i === COMPARISON.length - 1 ? 'none' : `1px solid ${line}`, alignItems: 'stretch' }}
              >
                <Grid item xs={12} sm={4} sx={{ p: 2 }}>
                  <Typography fontSize={14.5} fontWeight={700}>{row.label}</Typography>
                </Grid>
                <Grid item xs={6} sm={4} sx={{ p: 2 }}>
                  <Stack direction="row" spacing={1} alignItems="flex-start">
                    <CloseRounded sx={{ fontSize: 16, color: 'rgba(255,255,255,0.3)', mt: '2px' }} />
                    <Typography fontSize={13.5} color={textFaint}>{row.without}</Typography>
                  </Stack>
                </Grid>
                <Grid item xs={6} sm={4} sx={{ p: 2, bgcolor: `${cyan}08` }}>
                  <Stack direction="row" spacing={1} alignItems="flex-start">
                    <CheckRounded sx={{ fontSize: 16, color: cyan, mt: '2px' }} />
                    <Typography fontSize={13.5}>{row.with}</Typography>
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
    <Container id="depoimentos" maxWidth="lg" sx={{ py: { xs: 9, md: 12 }, scrollMarginTop: 88 }}>
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
                  icon={<TrendingUpRounded sx={{ fontSize: 14, color: `${cyan} !important` }} />}
                  label={t.metric}
                  sx={{ mt: 2, alignSelf: 'flex-start', bgcolor: 'rgba(37,244,238,0.1)', color: cyan, fontWeight: 700 }}
                />
                <Stack direction="row" spacing={1.5} alignItems="center" mt={2.5} pt={2.5} borderTop={`1px solid ${line}`}>
                  <Avatar sx={{ width: 36, height: 36, fontSize: 13, fontWeight: 800, background: `linear-gradient(135deg, ${red}, ${cyan})` }}>
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
      <Container maxWidth="lg" sx={{ py: { xs: 9, md: 12 } }}>
        <Reveal>
          <SectionHeading
            eyebrow="PLANOS"
            title="Comece grátis, escale quando fizer sentido"
            subtitle="Todo plano inclui a descoberta completa. Os créditos cobrem as ações com IA — roteiro, análise, transcrição, imagem e vídeo."
          />
        </Reveal>
        <Grid container spacing={3} alignItems="stretch">
          {PRICING.map((p, i) => (
            <Grid item xs={12} sm={6} md={3} key={p.id}>
              <Reveal delay={i * 100}>
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
                  {p.highlight && (
                    <Chip
                      size="small"
                      label="Mais popular"
                      sx={{ position: 'absolute', top: 14, right: 14, bgcolor: red, color: '#fff', fontWeight: 800, height: 22, fontSize: 11 }}
                    />
                  )}
                  <Typography fontSize={15} fontWeight={800} letterSpacing="0.02em">{p.name}</Typography>
                  <Typography fontSize={12.5} color={textFaint} mb={2}>{p.tagline}</Typography>
                  <Stack direction="row" alignItems="baseline" spacing={0.75}>
                    <Typography fontSize={34} fontWeight={800} letterSpacing="-0.03em">{brl(p.price)}</Typography>
                    {p.price > 0 && <Typography fontSize={13} color={textDim}>/mês</Typography>}
                  </Stack>
                  <Stack spacing={1.25} mt={3} flex={1}>
                    {p.perks.map((perk) => (
                      <Stack key={perk} direction="row" spacing={1.25} alignItems="flex-start">
                        <CheckRounded sx={{ fontSize: 16, color: cyan, mt: '2px' }} />
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
                        : { borderColor: lineStrong, color: '#fff', '&:hover': { borderColor: '#fff', bgcolor: 'rgba(255,255,255,0.04)' } }),
                    }}
                  >
                    {p.price === 0 ? 'Criar conta grátis' : 'Assinar'}
                  </Button>
                </Box>
              </Reveal>
            </Grid>
          ))}
        </Grid>
        <Reveal>
          <Stack direction="row" spacing={1} alignItems="center" justifyContent="center" mt={4} color={textFaint}>
            <FavoriteRounded sx={{ fontSize: 15, color: red }} />
            <Typography fontSize={13.5}>
              Sem fidelidade · cancele quando quiser · pacotes de crédito avulsos disponíveis
            </Typography>
          </Stack>
        </Reveal>
      </Container>
    </Box>
  );
}

/* -------------------------------------------------------------------- faq */

export function Faq() {
  return (
    <Container id="faq" maxWidth="md" sx={{ py: { xs: 9, md: 12 }, scrollMarginTop: 88 }}>
      <Reveal>
        <SectionHeading eyebrow="DÚVIDAS FREQUENTES" title="Perguntas que todo mundo faz" />
      </Reveal>
      <Reveal>
        <Stack spacing={1.5}>
          {FAQ.map((item) => (
            <Accordion
              key={item.q}
              disableGutters
              elevation={0}
              sx={{
                ...glass,
                '&::before': { display: 'none' },
                '&.Mui-expanded': { borderColor: `${cyan}44` },
              }}
            >
              <AccordionSummary
                expandIcon={<ExpandMoreRounded sx={{ color: textDim }} />}
                sx={{ px: 3, py: 1, '& .MuiAccordionSummary-content': { my: 1.75 } }}
              >
                <Typography fontSize={16} fontWeight={700}>{item.q}</Typography>
              </AccordionSummary>
              <AccordionDetails sx={{ px: 3, pb: 3, pt: 0 }}>
                <Typography fontSize={14.5} color={textDim} lineHeight={1.75}>{item.a}</Typography>
              </AccordionDetails>
            </Accordion>
          ))}
        </Stack>
      </Reveal>
    </Container>
  );
}

/* -------------------------------------------------------------- final cta */

export function FinalCta() {
  return (
    <Container maxWidth="lg" sx={{ py: { xs: 9, md: 13 } }}>
      <Reveal>
        <Box
          sx={{
            ...glass,
            position: 'relative', overflow: 'hidden', textAlign: 'center',
            px: { xs: 3, md: 8 }, py: { xs: 7, md: 10 },
            borderColor: `${red}33`,
          }}
        >
          <Box aria-hidden sx={{ position: 'absolute', top: -160, left: '15%', width: 380, height: 380, borderRadius: '50%', filter: 'blur(120px)', background: `${red}2e`, animation: 'lpBlob 18s ease-in-out infinite', pointerEvents: 'none' }} />
          <Box aria-hidden sx={{ position: 'absolute', bottom: -180, right: '10%', width: 360, height: 360, borderRadius: '50%', filter: 'blur(120px)', background: `${cyan}22`, animation: 'lpBlob 22s ease-in-out infinite reverse', pointerEvents: 'none' }} />
          <Box position="relative">
            <Typography sx={{ fontSize: { xs: 30, md: 46 }, fontWeight: 800, letterSpacing: '-0.03em', lineHeight: 1.1 }}>
              Pronto para vender <Box component="span" sx={gradientText}>antes da tendência</Box>?
            </Typography>
            <Typography color={textDim} fontSize={17.5} mt={2.5} maxWidth={560} mx="auto" lineHeight={1.65}>
              Crie sua conta em menos de um minuto, ganhe 30 créditos de boas-vindas e descubra hoje
              mesmo o que já está bombando no seu nicho.
            </Typography>
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} justifyContent="center" mt={4.5}>
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
                Criar conta grátis
              </Button>
              <Button
                href="#planos"
                size="large"
                sx={{
                  ...glass, color: '#fff', px: 4, py: 1.6, fontSize: 16,
                  '&:hover': { borderColor: `${cyan}66` },
                }}
              >
                Ver planos
              </Button>
            </Stack>
            <Typography fontSize={13} color={textFaint} mt={3}>
              Sem cartão de crédito · sem fidelidade
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
      <Container maxWidth="lg" sx={{ pt: 7, pb: 4 }}>
        <Grid container spacing={5}>
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
                      sx={{ fontSize: 14, color: textDim, textDecoration: 'none', '&:hover': { color: '#fff' } }}
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
              Plano gratuito para sempre, com 30 créditos de boas-vindas.
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
          <Typography fontSize={13} color={textFaint}>
            © {new Date().getFullYear()} PikPok — inteligência de produtos para o TikTok Shop
          </Typography>
          <Typography fontSize={13} color={textFaint}>
            Não afiliado ao TikTok · dados públicos consolidados
          </Typography>
        </Stack>
      </Container>
    </Box>
  );
}
