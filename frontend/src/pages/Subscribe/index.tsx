import { CheckRounded, LockRounded } from '@mui/icons-material';
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  Container,
  Stack,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from '@mui/material';
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { BrandLoader } from '@/components/ui/BrandLoader';
import { apiErrorMessage, useAuth } from '@/contexts/AuthContext';
import {
  billingService,
  type BillingCycle,
  type Plan,
  type Wallet,
} from '@/services/billing.service';

/**
 * Tela de assinatura — fora do app logado, de propósito.
 *
 * É onde para quem tem conta mas não tem assinatura: cadastro recém-feito ou
 * assinatura encerrada. Antes este bloqueio mandava o usuário para `/planos`,
 * que vive dentro do AppLayout — ou seja, ele continuava vendo o menu e as
 * telas do produto, todas quebrando em 403. Aqui não há menu nem rota de volta:
 * ou assina, ou sai da conta.
 *
 * Distinguir "nunca assinou" de "assinatura acabou" sai do extrato, não de uma
 * coluna nova: quem já teve um `plan_grant` um dia pagou.
 */
export function SubscribePage() {
  const { email, signOut } = useAuth();
  const navigate = useNavigate();
  const [wallet, setWallet] = useState<Wallet | null>(null);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [cycle, setCycle] = useState<BillingCycle>('month');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Volta do Stripe: confirma server-side e, com o plano ativo, entra no app.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('canceled')) {
      window.history.replaceState({}, '', '/assinatura');
      return;
    }
    const sessionId = params.get('session_id');
    if (!sessionId) return;
    window.history.replaceState({}, '', '/assinatura');
    billingService
      .confirmCheckout(sessionId)
      .then(() => navigate('/dashboard', { replace: true }))
      .catch((err) => setError(apiErrorMessage(err)));
  }, [navigate]);

  useEffect(() => {
    Promise.all([billingService.wallet(), billingService.plans()])
      .then(([w, p]) => {
        // Já assinou (ou o webhook chegou enquanto a tela carregava): não faz
        // sentido segurar ninguém aqui.
        if (w.plan !== 'free') {
          navigate('/dashboard', { replace: true });
          return;
        }
        setWallet(w);
        setPlans(p);
      })
      .catch((err) => setError(apiErrorMessage(err)));
  }, [navigate]);

  async function subscribe(planId: string) {
    setBusy(planId);
    setError(null);
    try {
      const { url } = await billingService.checkout({ planId, cycle });
      window.location.href = url;
    } catch (err) {
      setError(apiErrorMessage(err));
      setBusy(null);
    }
  }

  if (!wallet && !error) return <BrandLoader label="Verificando sua conta..." />;

  const expirou = Boolean(
    wallet?.history?.some((t) => t.kind === 'plan_grant'),
  );

  return (
    <Box sx={{ minHeight: '100vh', bgcolor: '#f6f7f9', py: { xs: 5, md: 8 } }}>
      <Container maxWidth="md">
        <Stack alignItems="center" spacing={1.5} mb={4} textAlign="center">
          {/* A marca precisa estar aqui: esta tela fica fora do AppLayout, então
              é a única do fluxo logado sem o cabeçalho — sem a logo, a pessoa
              cai numa página de cobrança que não parece ser do PikPok. */}
          <Stack direction="row" spacing={1} alignItems="center">
            <Box
              component="img"
              src="/icon-192.png"
              alt="PikPok"
              sx={{
                width: 38,
                height: 38,
                borderRadius: 2,
                boxShadow: '0 4px 14px #fe2c5544',
              }}
            />
            <Typography
              fontWeight={800}
              fontSize={22}
              sx={{ letterSpacing: '-0.02em' }}
            >
              Pik
              <Box component="span" sx={{ color: '#fe2c55' }}>
                Pok
              </Box>
            </Typography>
          </Stack>
          <LockRounded sx={{ fontSize: 40, color: '#fe2c55' }} />
          <Typography variant="h4" fontWeight={800}>
            {expirou ? 'Sua assinatura terminou' : 'Escolha seu plano'}
          </Typography>
          <Typography color="text.secondary" maxWidth={520}>
            {expirou
              ? 'O acesso ao radar de produtos e às ferramentas de IA está pausado. Reative para voltar de onde parou — seus dados e créditos continuam salvos.'
              : 'O PikPok trabalha com dados de mercado atualizados e IA — por isso o acesso é só para assinantes. Escolha um plano para começar.'}
          </Typography>
          {email && (
            <Chip label={email} size="small" sx={{ fontWeight: 600 }} />
          )}
        </Stack>

        {error && (
          <Alert severity="error" sx={{ mb: 3 }}>
            {error}
          </Alert>
        )}

        <Stack alignItems="center" mb={3}>
          <ToggleButtonGroup
            exclusive
            size="small"
            value={cycle}
            onChange={(_, v) => v && setCycle(v as BillingCycle)}
          >
            <ToggleButton value="month">Mensal</ToggleButton>
            <ToggleButton value="year">Anual</ToggleButton>
          </ToggleButtonGroup>
        </Stack>

        <Stack
          direction={{ xs: 'column', md: 'row' }}
          spacing={2.5}
          alignItems="stretch"
          justifyContent="center"
        >
          {plans.map((plan) => {
            const anual = cycle === 'year' && !!plan.annual;
            // Plano sem opção anual continua visível no ciclo anual, cobrado no
            // mensal — esconder o Business ao trocar o toggle daria a impressão
            // de que ele sumiu do catálogo.
            const price = anual ? plan.annual!.priceBrl : plan.priceBrl;
            const credits = anual
              ? plan.annual!.credits
              : plan.monthlyCredits;
            return (
              <Card
                key={plan.id}
                sx={{
                  flex: 1,
                  maxWidth: 380,
                  borderRadius: 4,
                  border: plan.highlight
                    ? '2px solid #fe2c55'
                    : '1px solid rgba(22,24,35,0.10)',
                  boxShadow: 'none',
                }}
              >
                <CardContent sx={{ p: 3 }}>
                  <Stack
                    direction="row"
                    alignItems="center"
                    spacing={1}
                    mb={1}
                  >
                    <Typography variant="h6" fontWeight={800}>
                      {plan.name}
                    </Typography>
                    {plan.highlight && (
                      <Chip
                        label="Mais popular"
                        size="small"
                        color="primary"
                        sx={{ fontWeight: 700 }}
                      />
                    )}
                  </Stack>

                  {plan.offer && !anual && (
                    <Typography
                      color="text.secondary"
                      sx={{ textDecoration: 'line-through' }}
                      fontSize={14}
                    >
                      R$ {plan.offer.listPriceBrl.toFixed(2)}
                    </Typography>
                  )}
                  <Stack direction="row" alignItems="baseline" spacing={0.5}>
                    <Typography variant="h4" fontWeight={800}>
                      R$ {price.toFixed(2)}
                    </Typography>
                    <Typography color="text.secondary">
                      /{anual ? 'ano' : 'mês'}
                    </Typography>
                  </Stack>
                  <Typography color="text.secondary" fontSize={14} mb={2}>
                    {credits.toLocaleString('pt-BR')} créditos de IA
                  </Typography>

                  <Stack spacing={1} mb={3}>
                    {plan.perks.map((perk) => (
                      <Stack
                        key={perk}
                        direction="row"
                        spacing={1}
                        alignItems="flex-start"
                      >
                        <CheckRounded
                          sx={{ fontSize: 18, color: '#0a9c97', mt: '2px' }}
                        />
                        <Typography fontSize={14}>{perk}</Typography>
                      </Stack>
                    ))}
                  </Stack>

                  <Button
                    fullWidth
                    size="large"
                    variant={plan.highlight ? 'contained' : 'outlined'}
                    disabled={busy !== null}
                    onClick={() => void subscribe(plan.id)}
                    sx={{ fontWeight: 800, borderRadius: 999 }}
                  >
                    {busy === plan.id
                      ? 'Abrindo pagamento…'
                      : expirou
                        ? 'Reativar'
                        : 'Assinar'}
                  </Button>
                </CardContent>
              </Card>
            );
          })}
        </Stack>

        <Stack alignItems="center" mt={4} spacing={1}>
          <Typography color="text.secondary" fontSize={13}>
            Pagamento seguro via Stripe. Cancele quando quiser.
          </Typography>
          <Button size="small" color="inherit" onClick={() => void signOut()}>
            Sair da conta
          </Button>
        </Stack>
      </Container>
    </Box>
  );
}
