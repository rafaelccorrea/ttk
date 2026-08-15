import AutoFixHighRoundedIcon from '@mui/icons-material/AutoFixHighRounded';
import CardGiftcardRoundedIcon from '@mui/icons-material/CardGiftcardRounded';
import DynamicFeedRoundedIcon from '@mui/icons-material/DynamicFeedRounded';
import SchoolRoundedIcon from '@mui/icons-material/SchoolRounded';
import DashboardRoundedIcon from '@mui/icons-material/DashboardRounded';
import GroupsRoundedIcon from '@mui/icons-material/GroupsRounded';
import LocalFireDepartmentRoundedIcon from '@mui/icons-material/LocalFireDepartmentRounded';
import OndemandVideoRoundedIcon from '@mui/icons-material/OndemandVideoRounded';
import LogoutRoundedIcon from '@mui/icons-material/LogoutRounded';
import StarRoundedIcon from '@mui/icons-material/StarRounded';
import StyleRoundedIcon from '@mui/icons-material/StyleRounded';
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
import { Link, Outlet, useLocation } from 'react-router-dom';
import { SupportFab } from '@/components/ui/SupportFab';
import { useAuth } from '@/contexts/AuthContext';

const DRAWER_WIDTH = 248;
const red = '#fe2c55';
const cyan = '#25f4ee';

interface NavItem {
  to: string;
  label: string;
  icon: JSX.Element;
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
      { to: '/produtos', label: 'Produtos', icon: <LocalFireDepartmentRoundedIcon /> },
      { to: '/videos', label: 'Vídeos que Vendem', icon: <OndemandVideoRoundedIcon /> },
      { to: '/criadores', label: 'Criadores', icon: <GroupsRoundedIcon /> },
      { to: '/favoritos', label: 'Favoritos', icon: <StarRoundedIcon /> },
    ],
  },
  {
    title: 'Estúdio',
    items: [
      { to: '/estudio', label: 'Roteirizar com IA', icon: <AutoFixHighRoundedIcon /> },
      { to: '/multiplicador', label: 'Multiplicador', icon: <DynamicFeedRoundedIcon /> },
      { to: '/prompts', label: 'Cofre de Prompts', icon: <StyleRoundedIcon /> },
    ],
  },
  {
    title: 'Programa',
    items: [
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
        <Box px={2.5} py={2.75}>
          <Typography variant="h6" fontWeight={800} letterSpacing="-0.02em">
            Pik
            <Box component="span" sx={{ color: red }}>
              Pok
            </Box>
          </Typography>
          <Typography variant="caption" sx={{ color: 'rgba(255,255,255,0.5)' }}>
            Inteligência TikTok Shop
          </Typography>
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
                  primaryTypographyProps={{ fontWeight: 600, fontSize: 14.5 }}
                />
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
              plano free
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
            label="atualizado hoje"
            sx={{
              bgcolor: 'rgba(37,244,238,0.12)',
              color: '#0a8a85',
              fontWeight: 700,
              height: 22,
            }}
          />
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
