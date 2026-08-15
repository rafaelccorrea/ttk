import AutoFixHighRoundedIcon from '@mui/icons-material/AutoFixHighRounded';
import CardGiftcardRoundedIcon from '@mui/icons-material/CardGiftcardRounded';
import DynamicFeedRoundedIcon from '@mui/icons-material/DynamicFeedRounded';
import SchoolRoundedIcon from '@mui/icons-material/SchoolRounded';
import DashboardRoundedIcon from '@mui/icons-material/DashboardRounded';
import GroupsRoundedIcon from '@mui/icons-material/GroupsRounded';
import LocalFireDepartmentRoundedIcon from '@mui/icons-material/LocalFireDepartmentRounded';
import OndemandVideoRoundedIcon from '@mui/icons-material/OndemandVideoRounded';
import LockRoundedIcon from '@mui/icons-material/LockRounded';
import LogoutRoundedIcon from '@mui/icons-material/LogoutRounded';
import MovieFilterRoundedIcon from '@mui/icons-material/MovieFilterRounded';
import SmartToyRoundedIcon from '@mui/icons-material/SmartToyRounded';
import StarRoundedIcon from '@mui/icons-material/StarRounded';
import StorefrontRoundedIcon from '@mui/icons-material/StorefrontRounded';
import StyleRoundedIcon from '@mui/icons-material/StyleRounded';
import TroubleshootRoundedIcon from '@mui/icons-material/TroubleshootRounded';
import TrendingUpRoundedIcon from '@mui/icons-material/TrendingUpRounded';
import WorkspacePremiumRoundedIcon from '@mui/icons-material/WorkspacePremiumRounded';
import BoltRoundedIcon from '@mui/icons-material/BoltRounded';
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
} from '@mui/material';
import { useEffect, useState } from 'react';
import { Link, Outlet, useLocation } from 'react-router-dom';
import { SupportFab } from '@/components/ui/SupportFab';
import { useAuth } from '@/contexts/AuthContext';
import { api, CREDITS_CHANGED_EVENT } from '@/services/api';
import { billingService } from '@/services/billing.service';

const DRAWER_WIDTH = 248;
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
    title: 'Minha Loja',
    items: [
      { to: '/loja', label: 'Painel da Loja', icon: <StorefrontRoundedIcon />, feature: 'stores' },
    ],
  },
  {
    title: 'Descoberta',
    items: [
      { to: '/produtos', label: 'Produtos', icon: <LocalFireDepartmentRoundedIcon /> },
      { to: '/videos', label: 'Vídeos que Vendem', icon: <OndemandVideoRoundedIcon /> },
      { to: '/tendencias', label: 'Tendências', icon: <TrendingUpRoundedIcon /> },
      { to: '/criadores', label: 'Criadores', icon: <GroupsRoundedIcon /> },
      { to: '/favoritos', label: 'Favoritos', icon: <StarRoundedIcon /> },
    ],
  },
  {
    title: 'Estúdio',
    items: [
      { to: '/estudio', label: 'Roteirizar com IA', icon: <AutoFixHighRoundedIcon /> },
      { to: '/analisar', label: 'Analisar Vídeo', icon: <TroubleshootRoundedIcon /> },
      { to: '/multiplicador', label: 'Multiplicador', icon: <DynamicFeedRoundedIcon /> },
      { to: '/prompts', label: 'Cofre de Prompts', icon: <StyleRoundedIcon /> },
      { to: '/geracoes', label: 'Minhas Gerações', icon: <MovieFilterRoundedIcon /> },
    ],
  },
  {
    title: 'Admin',
    items: [
      { to: '/coleta', label: 'Coleta de Dados', icon: <SmartToyRoundedIcon />, feature: 'ingestion' },
    ],
  },
  {
    title: 'Programa',
    items: [
      { to: '/planos', label: 'Planos & Créditos', icon: <WorkspacePremiumRoundedIcon /> },
      { to: '/academy', label: 'PikPok Educa', icon: <SchoolRoundedIcon /> },
      { to: '/indique', label: 'Indique e Ganhe', icon: <CardGiftcardRoundedIcon /> },
    ],
  },
];

const NAV = NAV_SECTIONS.flatMap((section) => section.items);

export function AppLayout() {
  const { email, signOut } = useAuth();
  const location = useLocation();
  const current = NAV.find((n) => location.pathname.startsWith(n.to));
  const [credits, setCredits] = useState<number | null>(null);
  const [features, setFeatures] = useState<Record<string, boolean>>({});
  const [plan, setPlan] = useState<string | null>(null);
  const [nextUpdate, setNextUpdate] = useState<{
    nextRunAt: string | null;
    isRunning: boolean;
  } | null>(null);
  const [, forceTick] = useState(0);

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
        })
        .catch(() => setCredits(null));
    load();
    window.addEventListener(CREDITS_CHANGED_EVENT, load);
    return () => window.removeEventListener(CREDITS_CHANGED_EVENT, load);
  }, [location.pathname]);

  return (
    <Box display="flex" minHeight="100vh" bgcolor="background.default">
      <Drawer
        variant="permanent"
        sx={{
          width: DRAWER_WIDTH,
          flexShrink: 0,
          '& .MuiDrawer-paper': {
            width: DRAWER_WIDTH,
            boxSizing: 'border-box',
            color: '#fff',
            background: `radial-gradient(70% 30% at 0% 0%, ${red}26 0%, transparent 60%), radial-gradient(60% 24% at 100% 100%, ${cyan}1a 0%, transparent 60%), #12131b`,
            borderRight: '1px solid rgba(255,255,255,0.06)',
            display: 'flex',
            flexDirection: 'column',
          },
        }}
      >
        <Box px={2.5} py={2.75} display="flex" alignItems="center" gap={1.5}>
          <Box
            component="img"
            src="/icon-192.png"
            alt="PikPok"
            sx={{ width: 40, height: 40, borderRadius: 2.5, boxShadow: `0 4px 14px ${red}44` }}
          />
          <Box>
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
          {NAV_SECTIONS.map((section, sectionIndex) => (
            <List
              key={section.title ?? sectionIndex}
              disablePadding
              sx={{ py: 0.75 }}
              subheader={
                section.title ? (
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
              <ListItemButton
                key={item.to}
                component={Link}
                to={item.to}
                selected={selected}
                sx={{
                  borderRadius: 2.5,
                  mb: 0.25,
                  py: 0.65,
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
                <ListItemIcon sx={{ minWidth: 38, color: 'inherit' }}>
                  {item.icon}
                </ListItemIcon>
                <ListItemText
                  primary={item.label}
                  primaryTypographyProps={{
                    fontWeight: 600,
                    fontSize: 14.5,
                    sx: locked ? { opacity: 0.55 } : undefined,
                  }}
                />
                {locked && (
                  <Tooltip title="Disponível em planos superiores — clique para ver">
                    <LockRoundedIcon
                      sx={{ fontSize: 15, color: 'rgba(255,255,255,0.45)' }}
                    />
                  </Tooltip>
                )}
              </ListItemButton>
                );
              })}
            </List>
          ))}
        </Box>

        <Divider sx={{ borderColor: 'rgba(255,255,255,0.06)' }} />
        <Box
          px={2}
          py={1.75}
          display="flex"
          alignItems="center"
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
          <Box flexGrow={1} minWidth={0}>
            <Typography variant="body2" noWrap fontWeight={600}>
              {email ?? '—'}
            </Typography>
            <Typography variant="caption" sx={{ color: 'rgba(255,255,255,0.5)' }}>
              plano {plan ?? '—'}
            </Typography>
          </Box>
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
        </Box>
      </Drawer>

      <Box component="main" flexGrow={1} minWidth={0} display="flex" flexDirection="column">
        {/* Header da página */}
        <Box
          sx={{
            position: 'sticky',
            top: 0,
            zIndex: 5,
            px: { xs: 2, md: 3 },
            py: 2,
            display: 'flex',
            alignItems: 'center',
            gap: 1.5,
            borderBottom: '1px solid rgba(22,24,35,0.06)',
            bgcolor: 'rgba(250,250,250,0.85)',
            backdropFilter: 'blur(10px)',
          }}
        >
          <Typography variant="h6" fontWeight={800} letterSpacing="-0.01em">
            {current?.label ?? 'Perfil'}
          </Typography>
          <Chip
            size="small"
            label={updateLabel}
            sx={{
              bgcolor: 'rgba(37,244,238,0.12)',
              color: '#0a8a85',
              fontWeight: 700,
              height: 22,
            }}
          />
          <Box flexGrow={1} />
          {credits !== null && (
            <Chip
              component={Link}
              to="/planos"
              clickable
              size="small"
              icon={<BoltRoundedIcon sx={{ fontSize: 16 }} />}
              label={`${credits} créditos`}
              sx={{
                bgcolor: 'rgba(254,44,85,0.10)',
                color: red,
                fontWeight: 700,
                height: 26,
                '& .MuiChip-icon': { color: red },
              }}
            />
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
