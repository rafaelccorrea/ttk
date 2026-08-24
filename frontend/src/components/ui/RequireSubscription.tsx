import AutoAwesomeRoundedIcon from '@mui/icons-material/AutoAwesomeRounded';
import GroupsRoundedIcon from '@mui/icons-material/GroupsRounded';
import StorefrontRoundedIcon from '@mui/icons-material/StorefrontRounded';
import { Box, Button, Paper, Stack, Typography } from '@mui/material';
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
/**
 * Rotas pagas que a conta gratuita PODE abrir quando a carteira diz que a
 * feature está liberada para ela. Hoje é só o copiloto: o painel abre no free
 * (com os 10 minutos de cortesia como único limite), e é o `features` do
 * backend — a mesma régua do `PlanFeatureGuard` — que decide, não este mapa.
 * O mapa só traduz prefixo de URL em nome de feature.
 */
const FEATURE_DA_ROTA: ReadonlyArray<[prefixo: string, feature: string]> = [
  ['/copiloto', 'live_copilot'],
];

export function RequireSubscription() {
  const [estado, setEstado] = useState<'carregando' | 'entra' | 'amostra' | 'sem-acesso'>(
    'carregando',
  );
  const [liberadas, setLiberadas] = useState<Record<string, boolean>>({});
  const location = useLocation();

  useEffect(() => {
    let active = true;
    billingService
      .wallet()
      .then((w) => {
        if (!active) return;
        setLiberadas((w.features ?? {}) as Record<string, boolean>);
        if (w.plan !== 'free') return setEstado('entra');
        setEstado(w.freeSample?.active ? 'amostra' : 'sem-acesso');
      })
      .catch(() => active && setEstado('entra'));
    return () => {
      active = false;
    };
  }, []);

  if (estado === 'carregando') {
    /*
     * O rótulo fala do que a pessoa está esperando (a tela), não do que o
     * sistema está fazendo (conferindo pagamento). "Verificando sua
     * assinatura" aparecia em toda navegação e transformava cada troca de tela
     * numa lembrança de cobrança — inclusive para quem já paga.
     */
    return <BrandLoader label="Carregando..." />;
  }
  if (estado === 'entra') return <Outlet />;
  if (estado === 'sem-acesso') return <Navigate to="/assinatura" replace />;
  // O login manda todo mundo para /dashboard: a conta gratuita segue dali para
  // a amostra, em vez de receber um bloqueio como primeira tela do app.
  if (location.pathname.startsWith('/dashboard')) {
    return <Navigate to="/produtos" replace />;
  }
  // Feature aberta no free pela carteira (ex.: o painel do copiloto) entra —
  // bloquear aqui o que o menu mostra destrancado seria o app se contradizendo.
  const abertaNoFree = FEATURE_DA_ROTA.some(
    ([prefixo, feature]) =>
      location.pathname.startsWith(prefixo) && liberadas[feature] === true,
  );
  if (abertaNoFree) return <Outlet />;
  return <BloqueioDePlano />;
}

/**
 * O que a conta gratuita vê ao clicar numa tela paga.
 *
 * O tom é deliberado. A primeira versão abria com "Esta área faz parte dos
 * planos pagos" — factual e, na prática, uma porta na cara: a pessoa clicou
 * num item do menu e recebeu uma cobrança. Aqui a tela começa pelo que ela JÁ
 * tem, mostra os caminhos abertos (a amostra, os criadores, o estúdio) e deixa
 * o plano como convite no fim. É a mesma informação, na ordem que não afasta.
 *
 * E nunca é uma tela vazia: os atalhos existem para que "não posso entrar
 * aqui" venha sempre com "então faça isto".
 */
function BloqueioDePlano() {
  const atalhos = [
    {
      to: '/produtos',
      icon: <StorefrontRoundedIcon />,
      titulo: 'Amostra da semana',
      texto: '20 produtos e 10 vídeos, atualizados a cada 7 dias',
    },
    {
      to: '/estudio',
      icon: <AutoAwesomeRoundedIcon />,
      titulo: 'Roteirizar com IA',
      texto: 'Use seus créditos para gerar um roteiro agora',
    },
    {
      to: '/criadores',
      icon: <GroupsRoundedIcon />,
      titulo: 'Criadores',
      texto: 'Veja perfis que vendem no TikTok Shop',
    },
  ];

  return (
    <Box sx={{ maxWidth: 620, mx: 'auto', mt: 5 }}>
      <Box sx={{ textAlign: 'center', mb: 3 }}>
        <Typography variant="h6" fontWeight={800} mb={0.5}>
          Esta parte abre com um plano
        </Typography>
        <Typography color="text.secondary">
          Sua conta gratuita continua com a amostra da semana, os créditos de IA
          e os favoritos. O ranking completo, as tendências e o histórico de
          cada produto vêm com a assinatura.
        </Typography>
      </Box>

      <Stack spacing={1.5}>
        {atalhos.map((a) => (
          <Paper
            key={a.to}
            component={Link}
            to={a.to}
            variant="outlined"
            sx={{
              p: 2,
              borderRadius: 3,
              display: 'flex',
              alignItems: 'center',
              gap: 2,
              textDecoration: 'none',
              color: 'inherit',
              '&:hover': { borderColor: '#fe2c55' },
            }}
          >
            <Box sx={{ color: '#fe2c55', display: 'flex', flexShrink: 0 }}>{a.icon}</Box>
            <Box minWidth={0}>
              <Typography fontWeight={700}>{a.titulo}</Typography>
              <Typography variant="body2" color="text.secondary">
                {a.texto}
              </Typography>
            </Box>
          </Paper>
        ))}
      </Stack>

      <Box sx={{ textAlign: 'center', mt: 3 }}>
        <Button component={Link} to="/planos" variant="contained" size="large">
          Conhecer os planos
        </Button>
      </Box>
    </Box>
  );
}
