import LockRoundedIcon from '@mui/icons-material/LockRounded';
import { Box, Button, Typography } from '@mui/material';
import { Link, Navigate, Outlet, useLocation } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { BrandLoader } from '@/components/ui/BrandLoader';
import { billingService } from '@/services/billing.service';

/**
 * Paywall na entrada: conta no plano `free` é "cadastro feito, pagamento
 * pendente" — ou assinatura encerrada, que volta ao mesmo estado. Nos dois
 * casos a pessoa não entra nas telas pagas.
 *
 * Para onde ela vai mudou com o modo amostra (`docs/CONTA-FREE.md`), e a
 * primeira tentativa estava errada de um jeito que só apareceu no navegador:
 * redirecionar TODA rota paga para `/produtos` fazia o menu inteiro parar de
 * responder. A pessoa clicava em "Tendências", a URL voltava sozinha para
 * Produtos e nada explicava o porquê — do lado de lá, isso não lê como plano,
 * lê como aplicativo quebrado.
 *
 * Então: rota paga clicada mostra a tela de bloqueio, **na própria URL**, com o
 * nome do que está travado e o caminho para assinar. A única exceção é
 * `/dashboard`, que é para onde o login manda todo mundo — ali um bloqueio
 * seria a primeira tela depois de entrar, então a conta gratuita é levada
 * direto para a amostra, que é a casa dela.
 *
 * Sem amostra (backend antigo, ou conta em estado que este front não conhece),
 * o comportamento é o de antes: `/assinatura`, fora do AppLayout.
 *
 * Isto é só a UX — a autoridade é o backend, que barra todas as rotas de dado e
 * de IA pelo PlanFeatureGuard.
 *
 * Em erro de rede a decisão é deixar passar: o backend barra de qualquer jeito,
 * e trancar o usuário fora do app por uma falha momentânea de /wallet seria
 * pior do que deixá-lo bater no 403.
 */
export function RequireSubscription() {
  const [estado, setEstado] = useState<'carregando' | 'entra' | 'amostra' | 'sem-acesso'>(
    'carregando',
  );
  const location = useLocation();

  useEffect(() => {
    let active = true;
    billingService
      .wallet()
      .then((w) => {
        if (!active) return;
        if (w.plan !== 'free') return setEstado('entra');
        setEstado(w.freeSample?.active ? 'amostra' : 'sem-acesso');
      })
      .catch(() => active && setEstado('entra'));
    return () => {
      active = false;
    };
  }, []);

  if (estado === 'carregando') {
    return <BrandLoader label="Verificando sua assinatura..." />;
  }
  if (estado === 'entra') return <Outlet />;
  if (estado === 'sem-acesso') return <Navigate to="/assinatura" replace />;
  // O login manda todo mundo para /dashboard: a conta gratuita segue dali para
  // a amostra, em vez de receber um bloqueio como primeira tela do app.
  if (location.pathname.startsWith('/dashboard')) {
    return <Navigate to="/produtos" replace />;
  }
  return <BloqueioDePlano />;
}

/**
 * O que a conta gratuita vê ao clicar numa tela paga.
 *
 * Fala do que ela TEM (a amostra continua ali, num clique) antes de falar do
 * que falta — uma tela de bloqueio que só cobra deixa a pessoa sem próximo
 * passo a não ser fechar a aba.
 */
function BloqueioDePlano() {
  return (
    <Box
      sx={{
        border: '1px dashed rgba(22,24,35,0.15)',
        borderRadius: 4,
        p: { xs: 4, md: 8 },
        textAlign: 'center',
        maxWidth: 560,
        mx: 'auto',
        mt: 6,
      }}
    >
      <LockRoundedIcon sx={{ fontSize: 44, color: '#fe2c55', mb: 1 }} />
      <Typography variant="h6" fontWeight={800} mb={0.5}>
        Esta área faz parte dos planos pagos
      </Typography>
      <Typography color="text.secondary" mb={2.5}>
        Sua conta gratuita vê uma amostra fixa de produtos e vídeos. Com um plano
        você abre o catálogo completo, as tendências, os criadores e todas as
        ferramentas de IA.
      </Typography>
      <Box sx={{ display: 'flex', gap: 1.5, justifyContent: 'center' }}>
        <Button component={Link} to="/produtos" variant="outlined">
          Voltar à amostra
        </Button>
        <Button component={Link} to="/planos" variant="contained">
          Ver planos
        </Button>
      </Box>
    </Box>
  );
}
