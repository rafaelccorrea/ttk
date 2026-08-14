import { AppBar, Box, Button, Toolbar, Typography } from '@mui/material';
import { Link, Outlet } from 'react-router-dom';
import styled from 'styled-components';
import { useAuth } from '@/contexts/AuthContext';

const Main = styled.main`
  padding: 24px;
  max-width: 1200px;
  margin: 0 auto;
`;

export function AppLayout() {
  const { email, signOut } = useAuth();

  return (
    <Box>
      <AppBar position="static">
        <Toolbar>
          <Typography variant="h6" sx={{ flexGrow: 1 }}>
            PikPok
          </Typography>
          <Button color="inherit" component={Link} to="/">
            Dashboard
          </Button>
          <Button color="inherit" component={Link} to="/produtos">
            Produtos
          </Button>
          <Button color="inherit" component={Link} to="/estudio">
            Estúdio
          </Button>
          <Button color="inherit" component={Link} to="/prompts">
            Prompts
          </Button>
          <Typography variant="body2" sx={{ mx: 2, opacity: 0.8 }}>
            {email}
          </Typography>
          <Button color="secondary" onClick={signOut}>
            Sair
          </Button>
        </Toolbar>
      </AppBar>
      <Main>
        <Outlet />
      </Main>
    </Box>
  );
}
