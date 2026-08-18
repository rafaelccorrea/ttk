import ShieldRoundedIcon from '@mui/icons-material/ShieldRounded';
import AutoFixHighRoundedIcon from '@mui/icons-material/AutoFixHighRounded';
import CardGiftcardRoundedIcon from '@mui/icons-material/CardGiftcardRounded';
import DynamicFeedRoundedIcon from '@mui/icons-material/DynamicFeedRounded';
import SchoolRoundedIcon from '@mui/icons-material/SchoolRounded';
import DashboardRoundedIcon from '@mui/icons-material/DashboardRounded';
import GroupsRoundedIcon from '@mui/icons-material/GroupsRounded';
import HeadsetMicRoundedIcon from '@mui/icons-material/HeadsetMicRounded';
import LocalFireDepartmentRoundedIcon from '@mui/icons-material/LocalFireDepartmentRounded';
import OndemandVideoRoundedIcon from '@mui/icons-material/OndemandVideoRounded';
import LockRoundedIcon from '@mui/icons-material/LockRounded';
import LogoutRoundedIcon from '@mui/icons-material/LogoutRounded';
import MovieFilterRoundedIcon from '@mui/icons-material/MovieFilterRounded';
import StarRoundedIcon from '@mui/icons-material/StarRounded';
import StyleRoundedIcon from '@mui/icons-material/StyleRounded';
import TheatersRoundedIcon from '@mui/icons-material/TheatersRounded';
import TroubleshootRoundedIcon from '@mui/icons-material/TroubleshootRounded';
import TrendingUpRoundedIcon from '@mui/icons-material/TrendingUpRounded';
import WorkspacePremiumRoundedIcon from '@mui/icons-material/WorkspacePremiumRounded';
import BoltRoundedIcon from '@mui/icons-material/BoltRounded';
import MenuOpenRoundedIcon from '@mui/icons-material/MenuOpenRounded';
import MenuRoundedIcon from '@mui/icons-material/MenuRounded';
import {
  Avatar,
  Box,
  Chip,
  Divider,
  Drawer,
  IconButton,
  List,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Tooltip,
  Typography,
  useMediaQuery,
  useTheme,
} from '@mui/material';
import { useEffect, useState } from 'react';
import { Link, Outlet, useLocation } from 'react-router-dom';
import { SupportFab } from '@/components/ui/SupportFab';
import { useAuth } from '@/contexts/AuthContext';
import { api, CREDITS_CHANGED_EVENT } from '@/services/api';
import { billingService } from '@/services/billing.service';
import { usersService } from '@/services/users.service';

const DRAWER_WIDTH = 248;
const DRAWER_WIDTH_COLLAPSED = 76;
const DRAWER_COLLAPSED_KEY = 'pikpok:drawer-collapsed';
const red = '#fe2c55';
const cyan = '#25f4ee';

interface NavItem {
  to: string;
  label: string;
  icon: JSX.Element;
  /** Recurso de plano (chave do backend); sem acesso → cadeado no drawer. */
  feature?: string;
}

interface NavSection {
  title: string | null;
  items: NavItem[];
}

const NAV_SECTIONS: NavSection[] = [
  {
    title: null,
    items: [
      { to: '/dashboard', label: 'Dashboard', icon: <DashboardRoundedIcon /> },
    ],
  },
  {
    title: 'Descoberta',
    items: [
      /*
       * Produtos e Vídeos NÃO levam `feature`, e é de propósito: a conta
       * gratuita entra nos dois (em modo amostra, ver docs/CONTA-FREE.md).
       * Marcá-los com `discovery` poria cadeado justamente nas duas portas que
       * ela pode abrir.
       */
      { to: '/produtos', label: 'Produtos', icon: <LocalFireDepartmentRoundedIcon /> },
      { to: '/videos', label: 'Vídeos que Vendem', icon: <OndemandVideoRoundedIcon /> },
      {
        to: '/tendencias',
        label: 'Tendências',
        icon: <TrendingUpRoundedIcon />,
        feature: 'discovery',
      },
      {
        to: '/criadores',
        label: 'Criadores',
        icon: <GroupsRoundedIcon />,
        feature: 'discovery',
      },
      {
        to: '/favoritos',
        label: 'Favoritos',
        icon: <StarRoundedIcon />,
        feature: 'discovery',
      },
    ],
  },
  {
    title: 'Estúdio',
    items: [
      {
        to: '/campanhas',
        label: 'Fábrica de Criativos',
        icon: <TheatersRoundedIcon />,
        feature: 'campaigns',
      },
      {
        to: '/estudio',
        label: 'Roteirizar com IA',
        icon: <AutoFixHighRoundedIcon />,
        feature: 'ai_scripts',
      },
      {
        to: '/analisar',
        label: 'Analisar Vídeo',
        icon: <TroubleshootRoundedIcon />,
        feature: 'ai_analyze',
      },
      {
        to: '/multiplicador',
        label: 'Multiplicador',
        icon: <DynamicFeedRoundedIcon />,
        feature: 'multiplier',
      },
      {
        to: '/copiloto',
        label: 'Copiloto de Live',
        icon: <HeadsetMicRoundedIcon />,
        feature: 'live_copilot',
      },
      { to: '/prompts', label: 'Cofre de Prompts', icon: <StyleRoundedIcon /> },
      { to: '/geracoes', label: 'Minhas Gerações', icon: <MovieFilterRoundedIcon /> },
    ],
  },
  {
    title: 'Programa',
    items: [
      { to: '/planos', label: 'Planos & Créditos', icon: <WorkspacePremiumRoundedIcon /> },
      // PikPok Educa fora do menu enquanto o conteúdo não está pronto. A rota
      // /academy continua de pé: quem tem o link direto acessa, e devolver o
      // item ao menu é descomentar esta linha.
      // { to: '/academy', label: 'PikPok Educa', icon: <SchoolRoundedIcon /> },
      { to: '/indique', label: 'Indique e Ganhe', icon: <CardGiftcardRoundedIcon /> },
    ],
  },
];

/**
 * Seção da equipe: só aparece para quem é administrador. Não é segurança — o
 * backend barra /admin de qualquer jeito — é para o menu do cliente não exibir
 * uma porta que ele não pode abrir.
 */
const ADMIN_SECTION: NavSection = {
  title: 'Equipe',
  items: [
    { to: '/admin', label: 'Administração', icon: <ShieldRoundedIcon /> },
  ],
};

const NAV = [...NAV_SECTIONS, ADMIN_SECTION].flatMap(
  (section) => section.items,
);

/**
 * O saldo de live em linguagem de vendedor.
 *
 * A venda é por HORA e o consumo é por minuto, então o selo fala em hora quando
 * há hora e em minuto quando o que resta é curto — "0h de live" para quarenta
 * minutos restantes seria a leitura mais desanimadora possível de um saldo que
 * ainda dá para uma transmissão inteira. Abaixo de uma hora o número exato
 * importa mais que a unidade redonda, porque é justamente quando o vendedor
 * decide se começa a live agora ou compra mais antes.
 */
export function formatarTempoDeLive(minutos: number): string {
  if (minutos <= 0) return 'sem horas de live';
  if (minutos < 60) return `${minutos} min de live`;
  const horas = Math.floor(minutos / 60);
  const resto = minutos % 60;
  return resto === 0
    ? `${horas}h de live`
    : `${horas}h${String(resto).padStart(2, '0')} de live`;
}

export function AppLayout() {
  const { email, signOut } = useAuth();
  const location = useLocation();
  const current = NAV.find((n) => location.pathname.startsWith(n.to));
  const [credits, setCredits] = useState<number | null>(null);
  /*
   * O saldo de live é uma MOEDA À PARTE, e por isso um estado à parte.
   *
   * Crédito paga o que se pede item a item (roteiro, imagem, transcrição); hora
   * de live paga o tempo com o copiloto ligado. Somar os dois num número só, ou
   * mostrar apenas um deles, faz o vendedor abrir a live achando que tem saldo
   * — e descobrir que não tem no meio da transmissão, que é o pior momento
   * possível para essa notícia.
   */
  const [minutosDeLive, setMinutosDeLive] = useState<number | null>(null);
  /*
   * A cortesia de estreia é creditada só quando a primeira transmissão começa
   * (ver `grantLiveTrial`), e não no cadastro — então quem nunca abriu o
   * copiloto tem saldo zero no banco, de verdade.
   *
   * Sem este estado o cabeçalho anunciava "sem horas de live", em laranja, para
   * um assinante Business que na prática tem dez minutos esperando por ele. Era
   * a nossa cortesia sendo apresentada como uma dívida — e o motivo mais barato
   * possível para alguém desistir de experimentar o produto.
   */
  const [cortesiaDeLive, setCortesiaDeLive] = useState<number | null>(null);
  /** Conta interna: os dois selos viram "ilimitado" em vez de um número morto. */
  const [ilimitado, setIlimitado] = useState(false);
  const [features, setFeatures] = useState<Record<string, boolean>>({});
  const [plan, setPlan] = useState<string | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [nextUpdate, setNextUpdate] = useState<{
    nextRunAt: string | null;
    isRunning: boolean;
  } | null>(null);
  const [, forceTick] = useState(0);
  // Drawer recolhível (só ícones) — preferência persistida no navegador.
  const [collapsedPref, setCollapsedPref] = useState(
    () => localStorage.getItem(DRAWER_COLLAPSED_KEY) === '1',
  );
  const theme = useTheme();
  // < md o menu vira gaveta temporária (overlay) e nunca fica recolhido.
  const isMobile = useMediaQuery(theme.breakpoints.down('md'));
  const [mobileOpen, setMobileOpen] = useState(false);
  const collapsed = isMobile ? false : collapsedPref;
  const drawerWidth = collapsed ? DRAWER_WIDTH_COLLAPSED : DRAWER_WIDTH;

  const toggleDrawer = () => {
    if (isMobile) {
      setMobileOpen((o) => !o);
      return;
    }
    setCollapsedPref((c) => {
      localStorage.setItem(DRAWER_COLLAPSED_KEY, c ? '0' : '1');
      return !c;
    });
  };

  // Fecha a gaveta ao navegar (mobile).
  useEffect(() => {
    setMobileOpen(false);
  }, [location.pathname]);

  // Em erro, segue como não-admin: o menu some, e nada quebra.
  useEffect(() => {
    usersService
      .me()
      .then((u) => setIsAdmin(Boolean(u.isAdmin)))
      .catch(() => setIsAdmin(false));
  }, []);

  // Timer da próxima leva de análises (visível a todos os planos).
  useEffect(() => {
    const load = () =>
      api
        .get('/analytics/next-update')
        .then((r) => setNextUpdate(r.data))
        .catch(() => setNextUpdate(null));
    load();
    const refetch = setInterval(load, 5 * 60_000); // re-sincroniza a cada 5 min
    const tick = setInterval(() => forceTick((t) => t + 1), 30_000); // contagem
    return () => {
      clearInterval(refetch);
      clearInterval(tick);
    };
  }, []);

  const updateLabel = (() => {
    if (nextUpdate?.isRunning) return 'atualizando agora...';
    const at = nextUpdate?.nextRunAt ? new Date(nextUpdate.nextRunAt) : null;
    if (!at) return 'atualizado hoje';
    const diffMin = Math.max(0, Math.round((at.getTime() - Date.now()) / 60_000));
    if (diffMin === 0) return 'atualizando agora...';
    const h = Math.floor(diffMin / 60);
    const m = diffMin % 60;
    return `próxima análise em ${h > 0 ? `${h}h ` : ''}${m}min`;
  })();

  // Atualiza o saldo a cada navegação E sempre que uma chamada gasta/compra
  // créditos (evento disparado pelo interceptor do axios).
  useEffect(() => {
    const load = () =>
      billingService
        .wallet()
        .then((w) => {
          setCredits(w.credits);
          setFeatures(w.features ?? {});
          setPlan(w.plan);
          setMinutosDeLive(w.liveCopilot?.minutes ?? null);
          setCortesiaDeLive(
            w.liveCopilot?.trialAvailable
              ? (w.liveCopilot?.trialMinutes ?? 0)
              : null,
          );
          setIlimitado(Boolean(w.unlimited));
        })
        .catch(() => setCredits(null));
    load();
    window.addEventListener(CREDITS_CHANGED_EVENT, load);
    return () => window.removeEventListener(CREDITS_CHANGED_EVENT, load);
  }, [location.pathname]);

  return (
    <Box display="flex" minHeight="100vh" bgcolor="background.default">
      <Drawer
        variant={isMobile ? 'temporary' : 'permanent'}
        open={isMobile ? mobileOpen : true}
        onClose={() => setMobileOpen(false)}
        ModalProps={{ keepMounted: true }}
        sx={{
          width: isMobile ? 0 : drawerWidth,
          flexShrink: 0,
          transition: 'width .22s ease',
          '& .MuiDrawer-paper': {
            width: drawerWidth,
            maxWidth: '86vw',
            overflowX: 'hidden',
            transition: 'width .22s ease',
            boxSizing: 'border-box',
            color: '#fff',
            background: `radial-gradient(70% 30% at 0% 0%, ${red}26 0%, transparent 60%), radial-gradient(60% 24% at 100% 100%, ${cyan}1a 0%, transparent 60%), #12131b`,
            borderRight: '1px solid rgba(255,255,255,0.06)',
            display: 'flex',
            flexDirection: 'column',
          },
        }}
      >
        <Box
          px={collapsed ? 1.5 : 2.5}
          py={2.75}
          display="flex"
          alignItems="center"
          gap={1.5}
          justifyContent={collapsed ? 'center' : undefined}
        >
          <Box
            component="img"
            src="/icon-192.png"
            alt="PikPok"
            sx={{ width: 40, height: 40, borderRadius: 2.5, boxShadow: `0 4px 14px ${red}44`, flexShrink: 0 }}
          />
          {!collapsed && (
            <Box minWidth={0}>
              <Typography variant="h6" fontWeight={800} letterSpacing="-0.02em" lineHeight={1.1}>
                Pik
                <Box component="span" sx={{ color: red }}>
                  Pok
                </Box>
              </Typography>
              <Typography variant="caption" sx={{ color: 'rgba(255,255,255,0.5)' }}>
                Inteligência TikTok Shop
              </Typography>
            </Box>
          )}
        </Box>
        <Divider sx={{ borderColor: 'rgba(255,255,255,0.06)' }} />

        <Box
          sx={{
            flexGrow: 1,
            overflowY: 'auto',
            px: 1.5,
            py: 0.5,
            // Sem barra de rolagem visível (continua rolável em telas baixas)
            scrollbarWidth: 'none',
            '&::-webkit-scrollbar': { display: 'none' },
          }}
        >
          {[...NAV_SECTIONS, ...(isAdmin ? [ADMIN_SECTION] : [])]
            /*
             * A conta gratuita não tem Dashboard: ela é redirecionada dali para
             * a amostra (ver RequireSubscription). Deixar o item no menu criaria
             * o pior tipo de link — o que sempre leva a outro lugar, sem
             * cadeado que explique. As demais telas pagas continuam à vista,
             * com cadeado: recurso invisível não vende degrau nenhum.
             */
            .map((section) => ({
              ...section,
              items:
                plan === 'free'
                  ? section.items.filter((i) => i.to !== '/dashboard')
                  : section.items,
            }))
            .filter((section) => section.items.length > 0)
            .map(
            (section, sectionIndex) => (
            <List
              key={section.title ?? sectionIndex}
              disablePadding
              sx={{ py: 0.75 }}
              subheader={
                section.title && !collapsed ? (
                  <Typography
                    variant="overline"
                    sx={{
                      display: 'block',
                      px: 1.5,
                      pb: 0.5,
                      fontSize: 10.5,
                      letterSpacing: '0.12em',
                      color: 'rgba(255,255,255,0.38)',
                    }}
                  >
                    {section.title}
                  </Typography>
                ) : undefined
              }
            >
              {section.items.map((item) => {
                const selected = location.pathname.startsWith(item.to);
                // Cadeado quando o plano não inclui o recurso (clique leva ao upgrade).
                const locked =
                  !!item.feature && features[item.feature] === false;
                return (
              <Tooltip
                key={item.to}
                title={collapsed ? item.label : ''}
                placement="right"
              >
              <ListItemButton
                component={Link}
                to={item.to}
                selected={selected}
                sx={{
                  borderRadius: 2.5,
                  mb: 0.25,
                  py: 0.65,
                  justifyContent: collapsed ? 'center' : undefined,
                  px: collapsed ? 1 : undefined,
                  color: 'rgba(255,255,255,0.62)',
                  position: 'relative',
                  transition: 'background-color .2s ease, color .2s ease, transform .15s ease',
                  '&:hover': {
                    backgroundColor: 'rgba(255,255,255,0.06)',
                    color: '#fff',
                    transform: 'translateX(2px)',
                  },
                  '&.Mui-selected': {
                    backgroundColor: 'rgba(254,44,85,0.16)',
                    color: '#fff',
                    '& .MuiListItemIcon-root': { color: red },
                    '&:hover': { backgroundColor: 'rgba(254,44,85,0.22)' },
                    '&::before': {
                      content: '""',
                      position: 'absolute',
                      left: 0,
                      top: 10,
                      bottom: 10,
                      width: 3,
                      borderRadius: 2,
                      background: `linear-gradient(180deg, ${red}, ${cyan})`,
                    },
                  },
                }}
              >
                <ListItemIcon
                  sx={{ minWidth: collapsed ? 0 : 38, color: 'inherit' }}
                >
                  {item.icon}
                </ListItemIcon>
                {!collapsed && (
                  <ListItemText
                    primary={item.label}
                    primaryTypographyProps={{
                      fontWeight: 600,
                      fontSize: 14.5,
                      sx: locked ? { opacity: 0.55 } : undefined,
                    }}
                  />
                )}
                {locked && !collapsed && (
                  <Tooltip title="Disponível em planos superiores — clique para ver">
                    <LockRoundedIcon
                      sx={{ fontSize: 15, color: 'rgba(255,255,255,0.45)' }}
                    />
                  </Tooltip>
                )}
              </ListItemButton>
              </Tooltip>
                );
              })}
            </List>
            ),
          )}
        </Box>

        <Divider sx={{ borderColor: 'rgba(255,255,255,0.06)' }} />
        <Box
          px={collapsed ? 1 : 2}
          py={1.75}
          display="flex"
          alignItems="center"
          justifyContent={collapsed ? 'center' : undefined}
          gap={1.25}
          component={Link}
          to="/perfil"
          sx={{
            textDecoration: 'none',
            color: 'inherit',
            transition: 'background-color .2s ease',
            '&:hover': { backgroundColor: 'rgba(255,255,255,0.05)' },
          }}
        >
          <Avatar
            sx={{
              width: 36,
              height: 36,
              fontSize: 14,
              fontWeight: 700,
              background: `linear-gradient(135deg, ${red}, #ff7a9c)`,
            }}
          >
            {(email ?? '?').slice(0, 1).toUpperCase()}
          </Avatar>
          {!collapsed && (
            <Box flexGrow={1} minWidth={0}>
              <Typography variant="body2" noWrap fontWeight={600}>
                {email ?? '—'}
              </Typography>
              <Typography variant="caption" sx={{ color: 'rgba(255,255,255,0.5)' }}>
                plano {plan ?? '—'}
              </Typography>
            </Box>
          )}
          {!collapsed && (
          <Tooltip title="Sair">
            <IconButton
              size="small"
              onClick={(e) => {
                e.preventDefault();
                signOut();
              }}
              aria-label="sair"
              sx={{ color: 'rgba(255,255,255,0.6)', '&:hover': { color: '#fff' } }}
            >
              <LogoutRoundedIcon fontSize="small" />
            </IconButton>
          </Tooltip>
          )}
        </Box>
      </Drawer>

      <Box component="main" flexGrow={1} minWidth={0} display="flex" flexDirection="column">
        {/* Header da página */}
        <Box
          sx={{
            position: 'sticky',
            top: 0,
            zIndex: 5,
            px: { xs: 1.5, md: 3 },
            py: { xs: 1.25, md: 2 },
            display: 'flex',
            alignItems: 'center',
            gap: { xs: 0.75, md: 1.5 },
            borderBottom: '1px solid rgba(22,24,35,0.06)',
            bgcolor: 'rgba(250,250,250,0.85)',
            backdropFilter: 'blur(10px)',
          }}
        >
          <Tooltip title={collapsed ? 'Expandir menu' : 'Recolher menu'}>
            <IconButton
              size="small"
              onClick={toggleDrawer}
              aria-label={collapsed ? 'expandir menu lateral' : 'recolher menu lateral'}
            >
              {isMobile || collapsed ? <MenuRoundedIcon /> : <MenuOpenRoundedIcon />}
            </IconButton>
          </Tooltip>
          <Typography
            variant="h6"
            fontWeight={800}
            letterSpacing="-0.01em"
            noWrap
            sx={{ fontSize: { xs: 15, sm: 20 }, minWidth: 0 }}
          >
            {current?.label ?? 'Perfil'}
          </Typography>
          <Chip
            size="small"
            label={updateLabel}
            sx={{
              display: { xs: 'none', md: 'inline-flex' },
              bgcolor: 'rgba(37,244,238,0.12)',
              color: '#0a8a85',
              fontWeight: 700,
              height: 22,
            }}
          />
          <Box flexGrow={1} />
          {/*
           * Duas moedas, dois selos, lado a lado — e o de live só aparece para
           * quem tem o recurso liberado. Mostrá-lo a quem não usa o copiloto
           * seria ocupar o cabeçalho com um saldo que nunca muda.
           *
           * O de live vem PRIMEIRO de propósito: quem está prestes a entrar ao
           * vivo precisa dessa informação antes de qualquer outra, e é a que
           * some enquanto a transmissão corre.
           */}
          {features.live_copilot &&
            minutosDeLive !== null &&
            (() => {
              /*
               * Três estados, não dois — e a diferença entre eles é a diferença
               * entre um convite e uma cobrança:
               *
               *  · cortesia à espera → verde, "N min grátis". É presente.
               *  · saldo comprado    → ciano, o tempo restante.
               *  · zerado de vez     → laranja, aviso.
               *
               * O caso que não pode existir é o laranja em cima de quem ainda
               * não gastou a cortesia: seria alarme sobre saldo que a conta tem.
               */
              const temCortesia =
                !ilimitado && minutosDeLive <= 0 && cortesiaDeLive !== null;
              const positivo = ilimitado || minutosDeLive > 0 || temCortesia;
              const cor = temCortesia
                ? { fundo: 'rgba(76,175,80,0.14)', tinta: '#1b6e21' }
                : positivo
                  ? { fundo: 'rgba(37,244,238,0.12)', tinta: '#0a8a85' }
                  : { fundo: 'rgba(255,152,0,0.16)', tinta: '#8a5200' };
              return (
                <Tooltip
                  title={
                    ilimitado
                      ? 'Conta interna: o copiloto ao vivo não consome minutos.'
                      : temCortesia
                        ? `Cortesia de estreia: ${cortesiaDeLive} minutos de copiloto ao vivo, por nossa conta. Só começam a contar quando você abrir a primeira transmissão.`
                        : minutosDeLive > 0
                          ? 'Tempo de copiloto respondendo o chat da sua live. É separado dos créditos de IA.'
                          : 'Suas horas de live acabaram. O copiloto não responde o chat sem elas.'
                  }
                >
                  <Chip
                    component={Link}
                    to="/planos"
                    clickable
                    size="small"
                    icon={<HeadsetMicRoundedIcon sx={{ fontSize: 16 }} />}
                    label={
                      ilimitado
                        ? 'live ilimitada'
                        : temCortesia
                          ? `${cortesiaDeLive} min grátis`
                          : formatarTempoDeLive(minutosDeLive)
                    }
                    sx={{
                      flexShrink: 0,
                      mr: 1,
                      bgcolor: cor.fundo,
                      color: cor.tinta,
                      fontWeight: 700,
                      height: 26,
                      '& .MuiChip-icon': { color: cor.tinta },
                    }}
                  />
                </Tooltip>
              );
            })()}
          {credits !== null && (
            <Tooltip
              title={
                ilimitado
                  ? 'Conta interna: os recursos de IA não consomem créditos.'
                  : 'Créditos de IA: roteiro, imagem, vídeo, transcrição e a base de conhecimento da live.'
              }
            >
              <Chip
                component={Link}
                to="/planos"
                clickable
                size="small"
                icon={<BoltRoundedIcon sx={{ fontSize: 16 }} />}
                label={ilimitado ? 'créditos ilimitados' : `${credits} créditos`}
                sx={{
                  flexShrink: 0,
                  bgcolor: 'rgba(254,44,85,0.10)',
                  color: red,
                  fontWeight: 700,
                  height: 26,
                  '& .MuiChip-icon': { color: red },
                }}
              />
            </Tooltip>
          )}
        </Box>

        {/* Sem maxWidth: o conteúdo ocupa toda a largura, colado às margens */}
        <Box px={{ xs: 2, md: 3 }} py={{ xs: 2.5, md: 3 }} flexGrow={1}>
          <Outlet />
        </Box>
      </Box>
      <SupportFab />
    </Box>
  );
}
