import BoltRoundedIcon from '@mui/icons-material/BoltRounded';
import CheckRoundedIcon from '@mui/icons-material/CheckRounded';
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
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
  TableRow,
  ToggleButton,
  ToggleButtonGroup,
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
  plan_grant: 'Plano',
  purchase: 'Compra',
  spend: 'Uso de IA',
  refund: 'Estorno',
};

export function PlansPage() {
  const [wallet, setWallet] = useState<Wallet | null>(null);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [packs, setPacks] = useState<CreditPack[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [cycle, setCycle] = useState<BillingCycle>('month');
  const [toast, setToast] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

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
    planId?: string;
    cycle?: BillingCycle;
  }) {
    const id = item.packId ?? item.planId!;
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

  const buyPack = (packId: string) => goToCheckout({ packId });
  const subscribe = (planId: string) => goToCheckout({ planId, cycle });

  if (!wallet && !error) return <BrandLoader label="Carregando sua carteira..." />;

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

      {wallet && (
        <Card sx={{ mb: 3 }}>
          <CardContent
            sx={{ display: 'flex', alignItems: 'center', gap: 2, flexWrap: 'wrap' }}
          >
            <BoltRoundedIcon sx={{ color: '#fe2c55', fontSize: 40 }} />
            <Box flexGrow={1}>
              <Typography variant="h4" fontWeight={800}>
                {wallet.credits}{' '}
                <Typography component="span" color="text.secondary">
                  créditos
                </Typography>
              </Typography>
              <Typography variant="body2" color="text.secondary">
                Plano atual: <b>{wallet.plan}</b>
              </Typography>
            </Box>
            <Box display="flex" gap={1} flexWrap="wrap">
              {Object.entries(wallet.prices).map(([key, p]) => (
                <Chip
                  key={key}
                  size="small"
                  label={`${p.label}: ${p.credits} cr`}
                  sx={{ fontWeight: 600 }}
                />
              ))}
            </Box>
          </CardContent>
        </Card>
      )}

      <Box
        display="flex"
        alignItems="center"
        justifyContent="space-between"
        flexWrap="wrap"
        gap={1.5}
        mb={1.5}
      >
        <Typography variant="h6">Planos</Typography>
        {/* Só faz sentido oferecer o toggle se algum plano tem opção anual. */}
        {plans.some((p) => p.annual) && (
          <ToggleButtonGroup
            size="small"
            exclusive
            value={cycle}
            onChange={(_e, value) => value && setCycle(value as BillingCycle)}
          >
            <ToggleButton value="month">Mensal</ToggleButton>
            <ToggleButton value="year">Anual</ToggleButton>
          </ToggleButtonGroup>
        )}
      </Box>
      <Grid container spacing={2} mb={4}>
        {plans.map((plan) => {
          const current = wallet?.plan === plan.id;
          // No ciclo anual, um plano sem opção anual cai de volta no mensal.
          const annual = cycle === 'year' && !!plan.annual;
          const price = annual ? plan.annual!.priceBrl : plan.priceBrl;
          const credits = annual ? plan.annual!.credits : plan.monthlyCredits;
          return (
            <Grid item xs={12} sm={6} md={4} key={plan.id}>
              <Card
                sx={{
                  height: '100%',
                  border: plan.highlight
                    ? '2px solid #fe2c55'
                    : '1px solid rgba(22,24,35,0.08)',
                  position: 'relative',
                }}
              >
                {plan.offer && (
                  <Chip
                    label={plan.offer.label}
                    size="small"
                    sx={{
                      position: 'absolute',
                      top: 12,
                      right: 12,
                      background: 'linear-gradient(135deg, #f59e0b, #ef4444)',
                      color: '#fff',
                      fontWeight: 700,
                    }}
                  />
                )}
                {plan.highlight && !plan.offer && (
                  <Chip
                    label="Mais popular"
                    size="small"
                    sx={{
                      position: 'absolute',
                      top: 12,
                      right: 12,
                      bgcolor: '#fe2c55',
                      color: '#fff',
                      fontWeight: 700,
                    }}
                  />
                )}
                <CardContent
                  sx={{ display: 'flex', flexDirection: 'column', height: '100%' }}
                >
                  <Typography variant="h6">{plan.name}</Typography>
                  <Typography variant="h5" fontWeight={800} my={0.5}>
                    {/* Preço de tabela riscado ao lado do promocional */}
                    {plan.offer && !annual && (
                      <Typography
                        component="span"
                        variant="body1"
                        color="text.secondary"
                        sx={{ textDecoration: 'line-through', mr: 1 }}
                      >
                        R$ {plan.offer.listPriceBrl.toFixed(2).replace('.', ',')}
                      </Typography>
                    )}
                    {price === 0
                      ? 'Grátis'
                      : `R$ ${price.toFixed(2).replace('.', ',')}`}
                    {price > 0 && (
                      <Typography component="span" variant="body2" color="text.secondary">
                        {annual ? '/ano' : '/mês'}
                      </Typography>
                    )}
                  </Typography>
                  {price > 0 && (
                    <Typography variant="caption" color="text.secondary">
                      {credits} créditos {annual ? 'no ano' : 'por mês'}
                      {annual && ` · R$ ${(price / 12).toFixed(2).replace('.', ',')}/mês`}
                    </Typography>
                  )}
                  <List dense sx={{ flexGrow: 1 }}>
                    {plan.perks.map((perk) => (
                      <ListItem key={perk} disableGutters sx={{ py: 0.25 }}>
                        <ListItemIcon sx={{ minWidth: 26 }}>
                          <CheckRoundedIcon fontSize="small" sx={{ color: '#00c2bb' }} />
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
                    variant={plan.highlight ? 'contained' : 'outlined'}
                    disabled={current || plan.id === 'free' || busy === plan.id}
                    onClick={() => subscribe(plan.id)}
                  >
                    {current ? 'Plano atual' : busy === plan.id ? 'Ativando...' : 'Assinar'}
                  </Button>
                </CardContent>
              </Card>
            </Grid>
          );
        })}
      </Grid>

      <Typography variant="h6" mb={1.5}>
        Pacotes avulsos
      </Typography>
      <Grid container spacing={2} mb={4}>
        {packs.map((pack) => (
          <Grid item xs={12} sm={4} key={pack.id}>
            <Card>
              <CardContent
                sx={{ display: 'flex', alignItems: 'center', gap: 2 }}
              >
                <Box flexGrow={1}>
                  <Typography fontWeight={700}>{pack.name}</Typography>
                  <Typography variant="body2" color="text.secondary">
                    R$ {pack.priceBrl.toFixed(2).replace('.', ',')}
                  </Typography>
                </Box>
                <Button
                  variant="outlined"
                  disabled={busy === pack.id}
                  onClick={() => buyPack(pack.id)}
                >
                  {busy === pack.id ? 'Comprando...' : 'Comprar'}
                </Button>
              </CardContent>
            </Card>
          </Grid>
        ))}
      </Grid>

      {wallet && wallet.history.length > 0 && (
        <>
          <Typography variant="h6" mb={1.5}>
            Extrato
          </Typography>
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
                {wallet.history.map((tx) => (
                  <TableRow key={tx.id}>
                    <TableCell>
                      {new Date(tx.createdAt).toLocaleString('pt-BR', {
                        day: '2-digit',
                        month: '2-digit',
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </TableCell>
                    <TableCell>{KIND_LABEL[tx.kind] ?? tx.kind}</TableCell>
                    <TableCell>{tx.description ?? '—'}</TableCell>
                    <TableCell
                      align="right"
                      sx={{
                        fontWeight: 700,
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
          </Card>
        </>
      )}

      <Divider sx={{ my: 3 }} />
      <Typography variant="caption" color="text.secondary">
        Pagamentos em modo de desenvolvimento: as compras creditam na hora, sem
        cobrança real. O checkout com Pix/cartão (Mercado Pago ou Stripe) será
        ativado antes do lançamento.
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
