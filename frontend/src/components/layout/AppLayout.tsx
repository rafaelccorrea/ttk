import AutoFixHighRoundedIcon from '@mui/icons-material/AutoFixHighRounded';
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
import { useAuth } from '@/contexts/AuthContext';

const DRAWER_WIDTH = 232;

const NAV = [
  { to: '/dashboard', label: 'Dashboard', icon: <DashboardRoundedIcon /> },
  { to: '/produtos', label: 'Produtos', icon: <LocalFireDepartmentRoundedIcon /> },
  { to: '/videos', label: 'Vídeos que Vendem', icon: <OndemandVideoRoundedIcon /> },
  { to: '/criadores', label: 'Criadores', icon: <GroupsRoundedIcon /> },
  { to: '/estudio', label: 'Estúdio IA', icon: <AutoFixHighRoundedIcon /> },
  { to: '/prompts', label: 'Cofre de Prompts', icon: <StyleRoundedIcon /> },
  { to: '/favoritos', label: 'Favoritos', icon: <StarRoundedIcon /> },
];

export function AppLayout() {
  const { email, signOut } = useAuth();
  const location = useLocation();

  return (
    <Box display="flex" minHeight="100vh">
      <Drawer
        variant="permanent"
        sx={{
          width: DRAWER_WIDTH,
          flexShrink: 0,
          '& .MuiDrawer-paper': {
            width: DRAWER_WIDTH,
            boxSizing: 'border-box',
            backgroundColor: '#ffffff',
            borderRight: '1px solid rgba(22,24,35,0.08)',
            display: 'flex',
            flexDirection: 'column',
          },
        }}
      >
        <Box px={2.5} py={2.5}>
          <Typography variant="h6" fontWeight={800}>
            Pik
            <Box component="span" sx={{ color: 'primary.main' }}>
              Pok
            </Box>
          </Typography>
          <Typography variant="caption" color="text.secondary">
            Inteligência TikTok Shop
          </Typography>
        </Box>
        <Divider />

        <List sx={{ px: 1.5, py: 2, flexGrow: 1 }}>
          {NAV.map((item) => {
            const selected =
              item.to === '/'
                ? location.pathname === '/'
                : location.pathname.startsWith(item.to);
            return (
              <ListItemButton
                key={item.to}
                component={Link}
                to={item.to}
                selected={selected}
                sx={{
                  borderRadius: 2.5,
                  mb: 0.5,
                  color: 'text.secondary',
                  '&.Mui-selected': {
                    backgroundColor: 'rgba(254,44,85,0.10)',
                    color: '#161823',
                    '& .MuiListItemIcon-root': { color: 'primary.main' },
                    '&:hover': { backgroundColor: 'rgba(254,44,85,0.16)' },
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

        <Divider />
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
            '&:hover': { backgroundColor: 'rgba(22,24,35,0.04)' },
          }}
        >
          <Avatar
            sx={{
              width: 34,
              height: 34,
              bgcolor: 'primary.main',
              fontSize: 14,
              fontWeight: 700,
            }}
          >
            {(email ?? '?').slice(0, 1).toUpperCase()}
          </Avatar>
          <Box flexGrow={1} minWidth={0}>
            <Typography variant="body2" noWrap fontWeight={600}>
              {email ?? '—'}
            </Typography>
            <Typography variant="caption" color="text.secondary">
              plano free
            </Typography>
          </Box>
          <Tooltip title="Sair">
            <IconButton size="small" onClick={signOut} aria-label="sair">
              <LogoutRoundedIcon fontSize="small" />
            </IconButton>
          </Tooltip>
        </Box>
      </Drawer>

      <Box component="main" flexGrow={1} px={{ xs: 2, md: 5 }} py={4}>
        <Box maxWidth={1200} mx="auto">
          <Outlet />
        </Box>
      </Box>
    </Box>
  );
}
