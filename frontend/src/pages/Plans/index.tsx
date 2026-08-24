import AutoAwesomeRoundedIcon from '@mui/icons-material/AutoAwesomeRounded';
import BoltRoundedIcon from '@mui/icons-material/BoltRounded';
import CheckRoundedIcon from '@mui/icons-material/CheckRounded';
import LiveTvRoundedIcon from '@mui/icons-material/LiveTvRounded';
import ReceiptLongRoundedIcon from '@mui/icons-material/ReceiptLongRounded';
import SettingsRoundedIcon from '@mui/icons-material/SettingsRounded';
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  Stack,
  Divider,
  Grid,
  List,
  ListItem,
  ListItemIcon,
  ListItemText,
  Snackbar,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TablePagination,
  TableRow,
  ToggleButton,
  ToggleButtonGroup,
  Tooltip,
  Typography,
} from '@mui/material';
import { useEffect, useState } from 'react';
import { BrandLoader } from '@/components/ui/BrandLoader';
import { ScrollX } from '@/components/ui/ScrollX';
import { apiErrorMessage } from '@/contexts/AuthContext';
import {
  billingService,
  BillingCycle,
  CreditPack,
  Plan,
  Wallet,
} from '@/services/billing.service';

const KIND_LABEL: Record<string, string> = {
  signup_bonus: 'Boas-vindas',
  sample_video: 'Cortesia',
  plan_grant: 'Plano',
  purchase: 'Compra',
  spend: 'Uso de IA',
  refund: 'Estorno',
};

/** Cada tipo de lançamento tem uma cor no extrato — a linha se lê sem ler. */
const KIND_COLOR: Record<string, string> = {
  signup_bonus: 'rgba(0,194,187,0.14)',
  sample_video: 'rgba(0,194,187,0.14)',
  plan_grant: 'rgba(254,44,85,0.12)',
  purchase: 'rgba(22,163,74,0.12)',
  spend: 'rgba(22,24,35,0.06)',
  refund: 'rgba(245,158,11,0.16)',
};

const brl = (v: number) => `R$ ${v.toFixed(2).replace('.', ',')}`;

/** "2h30" ou "45 min" — hora cheia só quando é hora cheia. */
function formatarSaldoDeLive(minutos: number): string {
  if (minutos <= 0) return 'nenhuma hora';
  if (minutos < 60) return `${minutos} min`;
  const horas = Math.floor(minutos / 60);
  const resto = minutos % 60;
  return resto === 0 ? `${horas}h` : `${horas}h${String(resto).padStart(2, '0')}`;
}

/**
 * Cabeçalho de seção — ícone, título e uma linha de contexto.
 *
 * A página vende três coisas diferentes (assinatura, hora de live e crédito
 * avulso) e antes elas apareciam como três `h6` soltos, indistinguíveis de um
 * parágrafo. Com o ícone e a régua, o olho encontra a seção que procura sem
 * precisar ler todas.
 */
function SectionHeader({
  icon,
  title,
  subtitle,
  action,
}: {
  icon: React.ReactNode;
  title: string;
  subtitle?: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <Box
      display="flex"
      alignItems={{ xs: 'flex-start', sm: 'center' }}
      justifyContent="space-between"
      flexWrap="wrap"
      gap={1.5}
      mb={1.5}
    >
      <Stack direction="row" spacing={1.5} alignItems="center" minWidth={0}>
        <Box
          sx={{
            width: 38,
            height: 38,
            borderRadius: 2.5,
            display: 'grid',
            placeItems: 'center',
            color: 'primary.main',
            flexShrink: 0,
            background:
              'linear-gradient(135deg, rgba(254,44,85,0.12), rgba(37,244,238,0.12))',
          }}
        >
          {icon}
        </Box>
        <Box minWidth={0}>
          <Typography variant="h6">{title}</Typography>
          {subtitle && (
            <Typography variant="body2" color="text.secondary">
              {subtitle}
            </Typography>
          )}
        </Box>
      </Stack>
      {action}
    </Box>
  );
}

export function PlansPage() {
  const [wallet, setWallet] = useState<Wallet | null>(null);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [packs, setPacks] = useState<CreditPack[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [cycle, setCycle] = useState<BillingCycle>('month');
  const [toast, setToast] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Extrato paginado no cliente: a carteira já vem com o lote inteiro, então
  // pedir página ao servidor só adicionaria latência a uma lista pequena.
  const [extratoPage, setExtratoPage] = useState(0);
  const [extratoPorPagina, setExtratoPorPagina] = useState(10);
  /*
   * Conta sem assinatura. Desde o modo amostra (docs/CONTA-FREE.md) ela CHEGA
   * nesta tela — antes era redirecionada antes de vê-la —, então o que é
   * exclusivo de assinante precisa se apresentar como tal aqui.
   */
  const semPlano = wallet?.plan === 'free';

  useEffect(() => {
    Promise.all([
      billingService.wallet(),
      billingService.plans(),
      billingService.packs(),
    ])
      .then(([w, p, k]) => {
        setWallet(w);
        setPlans(p);
        setPacks(k);
      })
      .catch((err) => setError(apiErrorMessage(err)));
  }, []);

  // Volta do Stripe: ?session_id=... → confirma server-side e credita.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const sessionId = params.get('session_id');
    if (params.get('canceled')) {
      setToast('Pagamento cancelado.');
      window.history.replaceState({}, '', '/planos');
      return;
    }
    if (!sessionId) return;
    window.history.replaceState({}, '', '/planos');
    billingService
      .confirmCheckout(sessionId)
      .then((w) => {
        setWallet(w);
        setToast('Pagamento confirmado — créditos adicionados!');
      })
      .catch((err) => setError(apiErrorMessage(err)));
  }, []);

  async function goToCheckout(item: {
    packId?: string;
    livePackId?: string;
    planId?: string;
    cycle?: BillingCycle;
  }) {
    const id = item.packId ?? item.livePackId ?? item.planId!;
    setBusy(id);
    setError(null);
    try {
      const { url } = await billingService.checkout(item);
      window.location.href = url; // página de pagamento do Stripe
    } catch (err) {
      setError(apiErrorMessage(err));
      setBusy(null);
    }
  }

  /** Billing Portal: cancelar, trocar cartão, baixar fatura. */
  async function openPortal() {
    setBusy('portal');
    setError(null);
    try {
      const { url } = await billingService.portal();
      window.location.href = url;
    } catch (err) {
      setError(apiErrorMessage(err));
      setBusy(null);
    }
  }

  const buyPack = (packId: string) => goToCheckout({ packId });
  const buyLivePack = (livePackId: string) => goToCheckout({ livePackId });
  const subscribe = (planId: string) => goToCheckout({ planId, cycle });

  if (!wallet && !error) return <BrandLoader label="Carregando sua carteira..." />;

  const temAnual = plans.some((p) => p.annual);
  // Maior economia anual entre os planos — justifica o toggle antes do clique.
  const economiaAnual = Math.max(
    0,
    ...plans
      .filter((p) => p.annual && p.priceBrl > 0)
      .map((p) =>
        Math.round((1 - p.annual!.priceBrl / (p.priceBrl * 12)) * 100),
      ),
  );
  // O melhor R$/hora da tabela de live, para marcar o pacote que compensa.
  const melhorPorHora = wallet?.liveCopilot?.packs.length
    ? Math.min(...wallet.liveCopilot.packs.map((p) => p.priceBrl / p.hours))
    : null;

  return (
    <>
      <Typography variant="h5">Planos & Créditos</Typography>
      <Typography color="text.secondary" mb={3}>
        Cada ação de IA consome créditos. Assine um plano para receber créditos
        todo mês, ou compre pacotes avulsos.
      </Typography>

      {error && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {error}
        </Alert>
      )}

      {/*
       * A carteira como painel, e não como linha de texto: é o número que a
       * pessoa vem conferir, e é a partir dele que ela decide se compra.
       */}
      {wallet && (
        <Card
          sx={{
            mb: 4,
            position: 'relative',
            overflow: 'hidden',
            background:
              'linear-gradient(135deg, rgba(254,44,85,0.06), rgba(37,244,238,0.06))',
            '&::before': {
              content: '""',
              position: 'absolute',
              inset: '0 0 auto 0',
              height: 3,
              background: 'linear-gradient(90deg, #fe2c55, #25f4ee)',
            },
          }}
        >
          <CardContent sx={{ py: 3 }}>
            <Grid container spacing={3} alignItems="center">
              <Grid item xs={12} md={wallet.liveCopilot ? 4 : 6}>
                <Stack direction="row" spacing={1.5} alignItems="center">
                  <BoltRoundedIcon sx={{ color: 'primary.main', fontSize: 40 }} />
                  <Box minWidth={0}>
                    <Typography
                      variant="overline"
                      color="text.secondary"
                      display="block"
                      lineHeight={1.4}
                    >
                      Créditos de IA
                    </Typography>
                    <Typography variant="h4" lineHeight={1.1}>
                      {wallet.unlimited ? '∞' : wallet.credits}
                    </Typography>
                  </Box>
                </Stack>
              </Grid>

              {/* A segunda moeda aparece aqui só para quem tem o recurso. */}
              {wallet.liveCopilot && (
                <Grid item xs={12} md={4}>
                  <Stack direction="row" spacing={1.5} alignItems="center">
                    <LiveTvRoundedIcon
                      sx={{ color: 'secondary.main', fontSize: 40 }}
                    />
                    <Box minWidth={0}>
                      <Typography
                        variant="overline"
                        color="text.secondary"
                        display="block"
                        lineHeight={1.4}
                      >
                        Horas de live
                      </Typography>
                      <Typography variant="h4" lineHeight={1.1}>
                        {formatarSaldoDeLive(wallet.liveCopilot.minutes)}
                      </Typography>
                    </Box>
                  </Stack>
                </Grid>
              )}

              <Grid item xs={12} md={wallet.liveCopilot ? 4 : 6}>
                <Stack
                  direction="row"
                  spacing={1}
                  alignItems="center"
                  flexWrap="wrap"
                  justifyContent={{ xs: 'flex-start', md: 'flex-end' }}
                  useFlexGap
                >
                  <Chip
                    label={`Plano ${wallet.plan}`}
                    sx={{
                      fontWeight: 700,
                      bgcolor: 'primary.main',
                      color: '#fff',
                      textTransform: 'capitalize',
                    }}
                  />
                  {wallet.plan !== 'free' && (
                    <Button
                      size="small"
                      variant="outlined"
                      startIcon={<SettingsRoundedIcon />}
                      disabled={busy === 'portal'}
                      onClick={openPortal}
                    >
                      {busy === 'portal' ? 'Abrindo...' : 'Gerenciar assinatura'}
                    </Button>
                  )}
                </Stack>
              </Grid>
            </Grid>

            {/* Tabela de consumo: o que cada ação custa, sem sair da página. */}
            {Object.keys(wallet.prices).length > 0 && (
              <>
                <Divider sx={{ my: 2 }} />
                <Typography
                  variant="overline"
                  color="text.secondary"
                  display="block"
                  mb={1}
                >
                  Quanto custa cada ação
                </Typography>
                <Box display="flex" gap={1} flexWrap="wrap">
                  {Object.entries(wallet.prices).map(([key, p]) => (
                    <Chip
                      key={key}
                      size="small"
                      variant="outlined"
                      label={
                        <>
                          {p.label} ·{' '}
                          <b style={{ color: '#fe2c55' }}>{p.credits} cr</b>
                        </>
                      }
                      sx={{ bgcolor: 'background.paper' }}
                    />
                  ))}
                </Box>
              </>
            )}
          </CardContent>
        </Card>
      )}

      <SectionHeader
        icon={<AutoAwesomeRoundedIcon />}
        title="Planos"
        subtitle="Créditos renovados todo período, sem fidelidade."
        action={
          // Só faz sentido oferecer o toggle se algum plano tem opção anual.
          temAnual ? (
            <Stack
              direction="row"
              spacing={1}
              alignItems="center"
              flexWrap="wrap"
              useFlexGap
            >
              {economiaAnual > 0 && cycle === 'month' && (
                <Chip
                  size="small"
                  label={`anual economiza até ${economiaAnual}%`}
                  sx={{
                    fontWeight: 700,
                    bgcolor: 'rgba(22,163,74,0.12)',
                    color: 'success.main',
                  }}
                />
              )}
              <ToggleButtonGroup
                size="small"
                exclusive
                value={cycle}
                onChange={(_e, value) => value && setCycle(value as BillingCycle)}
              >
                <ToggleButton value="month">Mensal</ToggleButton>
                <ToggleButton value="year">Anual</ToggleButton>
              </ToggleButtonGroup>
            </Stack>
          ) : undefined
        }
      />
      <Grid container spacing={2} mb={4} alignItems="stretch">
        {plans.map((plan) => {
          const current = wallet?.plan === plan.id;
          // No ciclo anual, um plano sem opção anual cai de volta no mensal.
          const annual = cycle === 'year' && !!plan.annual;
          const price = annual ? plan.annual!.priceBrl : plan.priceBrl;
          const credits = annual ? plan.annual!.credits : plan.monthlyCredits;
          const destaque = !!plan.highlight;
          return (
            <Grid item xs={12} sm={6} md={4} key={plan.id}>
              <Card
                sx={{
                  height: '100%',
                  position: 'relative',
                  overflow: 'hidden',
                  borderColor: destaque ? 'primary.main' : undefined,
                  // O plano recomendado ganha anel e sombra em vez de borda
                  // grossa: destaca sem desalinhar o card dos vizinhos.
                  boxShadow: destaque
                    ? '0 0 0 2px rgba(254,44,85,0.35), 0 10px 30px rgba(254,44,85,0.14)'
                    : undefined,
                  ...(current && {
                    borderColor: 'secondary.main',
                    boxShadow: '0 0 0 2px rgba(0,194,187,0.35)',
                  }),
                }}
              >
                {destaque && (
                  <Box
                    sx={{
                      height: 4,
                      background: 'linear-gradient(90deg, #fe2c55, #25f4ee)',
                    }}
                  />
                )}
                {plan.offer && (
                  <Chip
                    label={plan.offer.label}
                    size="small"
                    sx={{
                      position: 'absolute',
                      top: 14,
                      right: 12,
                      background: 'linear-gradient(135deg, #f59e0b, #ef4444)',
                      color: '#fff',
                      fontWeight: 700,
                    }}
                  />
                )}
                {destaque && !plan.offer && (
                  <Chip
                    label="Mais popular"
                    size="small"
                    sx={{
                      position: 'absolute',
                      top: 14,
                      right: 12,
                      bgcolor: 'primary.main',
                      color: '#fff',
                      fontWeight: 700,
                    }}
                  />
                )}
                {current && (
                  <Chip
                    label="Seu plano"
                    size="small"
                    sx={{
                      position: 'absolute',
                      top: 14,
                      left: 12,
                      bgcolor: 'secondary.main',
                      color: '#fff',
                      fontWeight: 700,
                    }}
                  />
                )}
                <CardContent
                  sx={{
                    display: 'flex',
                    flexDirection: 'column',
                    height: '100%',
                    pt: current || plan.offer || destaque ? 5.5 : 2.5,
                  }}
                >
                  <Typography variant="h6">{plan.name}</Typography>

                  <Box display="flex" alignItems="baseline" flexWrap="wrap" gap={0.75} mt={0.5}>
                    {/* Preço de tabela riscado ao lado do promocional */}
                    {plan.offer && !annual && (
                      <Typography
                        variant="body1"
                        color="text.secondary"
                        sx={{ textDecoration: 'line-through' }}
                      >
                        {brl(plan.offer.listPriceBrl)}
                      </Typography>
                    )}
                    <Typography variant="h4" lineHeight={1.1}>
                      {price === 0 ? 'Grátis' : brl(price)}
                    </Typography>
                    {price > 0 && (
                      <Typography variant="body2" color="text.secondary">
                        {annual ? '/ano' : '/mês'}
                      </Typography>
                    )}
                  </Box>

                  {price > 0 && (
                    <Stack
                      direction="row"
                      spacing={0.75}
                      flexWrap="wrap"
                      useFlexGap
                      mt={1}
                      mb={0.5}
                    >
                      <Chip
                        size="small"
                        label={`${credits} créditos ${annual ? 'no ano' : '/mês'}`}
                        sx={{
                          bgcolor: 'rgba(254,44,85,0.10)',
                          color: 'primary.main',
                          fontWeight: 700,
                        }}
                      />
                      {annual && (
                        <Chip
                          size="small"
                          variant="outlined"
                          label={`equivale a ${brl(price / 12)}/mês`}
                        />
                      )}
                    </Stack>
                  )}

                  <List dense sx={{ flexGrow: 1 }}>
                    {plan.perks.map((perk) => (
                      <ListItem key={perk} disableGutters sx={{ py: 0.25 }}>
                        <ListItemIcon sx={{ minWidth: 26 }}>
                          <CheckRoundedIcon
                            fontSize="small"
                            sx={{ color: 'secondary.main' }}
                          />
                        </ListItemIcon>
                        <ListItemText
                          primary={perk}
                          primaryTypographyProps={{ variant: 'body2' }}
                        />
                      </ListItem>
                    ))}
                  </List>
                  <Button
                    fullWidth
                    size="large"
                    variant={destaque ? 'contained' : 'outlined'}
                    disabled={current || plan.id === 'free' || busy === plan.id}
                    onClick={() => subscribe(plan.id)}
                  >
                    {current
                      ? 'Plano atual'
                      : busy === plan.id
                        ? 'Ativando...'
                        : plan.id === 'free'
                          ? 'Plano de entrada'
                          : 'Assinar'}
                  </Button>
                </CardContent>
              </Card>
            </Grid>
          );
        })}
      </Grid>

      {/*
       * As HORAS DE LIVE, que são a segunda moeda do produto.
       *
       * Ficam num bloco próprio, e não junto dos pacotes de crédito, porque as
       * duas moedas NÃO se convertem: crédito paga o que se pede item a item
       * (roteiro, imagem, a base da live), hora paga o tempo com o copiloto
       * ligado no ar. Listadas lado a lado, a leitura natural seria que uma vira
       * a outra — e o vendedor compraria crédito achando que está comprando
       * tempo de live, descobrindo o contrário no meio da transmissão.
       *
       * O bloco só aparece para quem tem o recurso: oferecer hora de copiloto a
       * quem não pode usá-lo é vender o que não funciona.
       */}
      {wallet?.features?.live_copilot && wallet.liveCopilot && (
        <>
          <SectionHeader
            icon={<LiveTvRoundedIcon />}
            title="Horas de Live Copilot"
            subtitle={
              <>
                Moeda separada: <strong>não sai dos seus créditos de IA</strong> e
                não expira. Cada transmissão debita um bloco mínimo de 10
                minutos
                {/*
                 * A frase das horas de adesão fala no tempo certo para cada
                 * conta: quem assina JÁ recebeu as horas; a free ainda não —
                 * para ela o que existe é a cortesia, e as horas são o que vem
                 * se assinar.
                 */}
                {semPlano
                  ? '; você tem 10 minutos de cortesia para conhecer; assinando, o plano vem com 15, 40 ou 60 horas.'
                  : ', e cada plano já começa com horas de live inclusas na adesão.'}
                {wallet.liveCopilot.trialAvailable
                  ? ` Você ainda tem ${wallet.liveCopilot.trialMinutes} minutos de cortesia para testar antes de comprar.`
                  : ` Saldo atual: ${formatarSaldoDeLive(wallet.liveCopilot.minutes)}.`}
              </>
            }
          />
          <Grid container spacing={2} mb={4} alignItems="stretch">
            {wallet.liveCopilot.packs.map((pack) => {
              // O preço por hora é o que torna os pacotes comparáveis. Sem ele,
              // "40 horas por R$ 299,90" é um número grande sem referência, e o
              // desconto de volume que existe de verdade não aparece.
              const porHora = pack.priceBrl / pack.hours;
              // A avulsa é a compra de emergência — saldo acabou com a live no
              // ar. Marcada para não ser confundida com a opção econômica: ela
              // é, de propósito, a mais cara por hora.
              const avulsa = pack.hours === 1;
              const melhor = melhorPorHora !== null && porHora === melhorPorHora;
              return (
                <Grid item xs={12} sm={6} md={3} key={pack.id}>
                  <Card
                    sx={{
                      height: '100%',
                      display: 'flex',
                      borderColor: melhor ? 'secondary.main' : undefined,
                      boxShadow: melhor
                        ? '0 0 0 2px rgba(0,194,187,0.30)'
                        : undefined,
                    }}
                  >
                    <CardContent
                      sx={{
                        display: 'flex',
                        flexDirection: 'column',
                        width: '100%',
                      }}
                    >
                      <Stack
                        direction="row"
                        spacing={1}
                        alignItems="center"
                        flexWrap="wrap"
                        useFlexGap
                        mb={0.25}
                      >
                        <Typography variant="h5">{pack.hours}h</Typography>
                        {avulsa && (
                          <Tooltip title="Para uma emergência no meio da live — é a opção mais cara por hora.">
                            <Chip size="small" variant="outlined" label="avulsa" />
                          </Tooltip>
                        )}
                        {melhor && !avulsa && (
                          <Chip
                            size="small"
                            label="melhor preço/hora"
                            sx={{
                              bgcolor: 'rgba(0,194,187,0.14)',
                              color: 'secondary.main',
                              fontWeight: 700,
                            }}
                          />
                        )}
                      </Stack>
                      <Typography variant="h6" fontWeight={800}>
                        {brl(pack.priceBrl)}
                      </Typography>
                      <Typography
                        variant="body2"
                        color="text.secondary"
                        sx={{ flexGrow: 1 }}
                        mb={1.5}
                      >
                        {brl(porHora)} por hora
                      </Typography>
                      <Button
                        fullWidth
                        variant={melhor ? 'contained' : 'outlined'}
                        color={melhor ? 'secondary' : 'primary'}
                        disabled={busy === pack.id}
                        onClick={() => buyLivePack(pack.id)}
                      >
                        {busy === pack.id ? 'Comprando...' : 'Comprar horas'}
                      </Button>
                    </CardContent>
                  </Card>
                </Grid>
              );
            })}
          </Grid>
        </>
      )}

      <SectionHeader
        icon={<BoltRoundedIcon />}
        title="Pacotes avulsos de créditos"
        subtitle={
          /*
           * "sem assinatura" é verdade sobre a COBRANÇA (é compra única, não
           * recorrência) e mentira sobre o ACESSO: `assertSubscriber` recusa
           * pacote de quem não assina, e as ações de IA exigem plano de
           * qualquer forma. Com a conta gratuita passando a ver esta tela, a
           * frase antiga levava direto a um botão que só devolve erro — ou,
           * pior, venderia crédito que ela não teria como gastar.
           */
          semPlano
            ? 'Compra única para quem já tem plano — os pacotes reforçam a cota do mês.'
            : 'Compra única, sem recorrência — os créditos entram na hora.'
        }
      />
      <Grid container spacing={2} mb={4} alignItems="stretch">
        {packs.map((pack) => (
          <Grid item xs={12} sm={6} md={4} key={pack.id}>
            <Card sx={{ height: '100%', display: 'flex' }}>
              <CardContent
                sx={{ display: 'flex', alignItems: 'center', gap: 2, width: '100%' }}
              >
                <Box flexGrow={1} minWidth={0}>
                  <Typography fontWeight={700}>{pack.name}</Typography>
                  <Stack
                    direction="row"
                    spacing={1}
                    alignItems="baseline"
                    flexWrap="wrap"
                    useFlexGap
                  >
                    <Typography variant="h6" fontWeight={800}>
                      {brl(pack.priceBrl)}
                    </Typography>
                    <Typography variant="body2" color="text.secondary">
                      {pack.credits} créditos
                    </Typography>
                  </Stack>
                  <Typography variant="caption" color="text.secondary">
                    {brl(pack.priceBrl / pack.credits)} por crédito
                  </Typography>
                </Box>
                <Tooltip
                  title={
                    semPlano
                      ? 'Assine um plano para comprar pacotes — crédito avulso não destrava os recursos.'
                      : ''
                  }
                >
                  {/* <span> porque botão desabilitado não emite os eventos que
                      o Tooltip escuta — sem ele, a explicação não aparece
                      justamente para quem precisa dela. */}
                  <span style={{ flexShrink: 0 }}>
                    <Button
                      variant="outlined"
                      disabled={busy === pack.id || semPlano}
                      onClick={() => buyPack(pack.id)}
                    >
                      {busy === pack.id ? 'Comprando...' : 'Comprar'}
                    </Button>
                  </span>
                </Tooltip>
              </CardContent>
            </Card>
          </Grid>
        ))}
      </Grid>

      {wallet && wallet.history.length > 0 && (
        <>
          <SectionHeader
            icon={<ReceiptLongRoundedIcon />}
            title="Extrato"
            subtitle={`Últimos ${wallet.history.length} lançamentos da sua carteira.`}
          />
          <Card>
            <ScrollX>
              <Table size="small" sx={{ minWidth: 560 }}>
                <TableHead>
                  <TableRow>
                    <TableCell>Data</TableCell>
                    <TableCell>Tipo</TableCell>
                    <TableCell>Descrição</TableCell>
                    <TableCell align="right">Créditos</TableCell>
                    <TableCell align="right">Saldo</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {wallet.history
                    .slice(
                      extratoPage * extratoPorPagina,
                      extratoPage * extratoPorPagina + extratoPorPagina,
                    )
                    .map((tx) => (
                    <TableRow key={tx.id}>
                      <TableCell sx={{ whiteSpace: 'nowrap' }}>
                        {new Date(tx.createdAt).toLocaleString('pt-BR', {
                          day: '2-digit',
                          month: '2-digit',
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </TableCell>
                      <TableCell>
                        <Chip
                          size="small"
                          label={KIND_LABEL[tx.kind] ?? tx.kind}
                          sx={{
                            bgcolor: KIND_COLOR[tx.kind] ?? 'rgba(22,24,35,0.06)',
                            fontWeight: 600,
                          }}
                        />
                      </TableCell>
                      <TableCell>{tx.description ?? '—'}</TableCell>
                      <TableCell
                        align="right"
                        sx={{
                          fontWeight: 700,
                          whiteSpace: 'nowrap',
                          color: tx.amount >= 0 ? '#0a8a85' : '#fe2c55',
                        }}
                      >
                        {tx.amount >= 0 ? `+${tx.amount}` : tx.amount}
                      </TableCell>
                      <TableCell align="right">{tx.balanceAfter}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </ScrollX>
            {/* Fora do ScrollX: o controle acompanha a página, não a rolagem
                horizontal da tabela. */}
            <TablePagination
              component="div"
              count={wallet.history.length}
              page={extratoPage}
              onPageChange={(_e, p) => setExtratoPage(p)}
              rowsPerPage={extratoPorPagina}
              onRowsPerPageChange={(e) => {
                setExtratoPorPagina(Number(e.target.value));
                setExtratoPage(0);
              }}
              rowsPerPageOptions={[5, 10, 25, 50]}
              labelRowsPerPage="Por página"
              labelDisplayedRows={({ from, to, count }) =>
                `${from}–${to} de ${count}`
              }
              sx={{
                borderTop: '1px solid rgba(22,24,35,0.08)',
                // Em 360px a barra (seletor + "1–10 de 40" + setas) não cabe
                // numa linha: deixa quebrar em vez de empurrar a página.
                '& .MuiTablePagination-toolbar': {
                  flexWrap: 'wrap',
                  px: { xs: 1, sm: 2 },
                },
              }}
            />
          </Card>
        </>
      )}

      <Divider sx={{ my: 3 }} />
      <Typography variant="caption" color="text.secondary">
        Pagamento processado pelo Stripe — não guardamos os dados do seu cartão.
        Assinaturas podem ser canceladas a qualquer momento em “Gerenciar
        assinatura”.
      </Typography>

      <Snackbar
        open={!!toast}
        autoHideDuration={4000}
        onClose={() => setToast(null)}
        message={toast}
      />
    </>
  );
}
