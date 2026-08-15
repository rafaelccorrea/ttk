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
  Typography,
} from '@mui/material';
import { useEffect, useState } from 'react';
import { BrandLoader } from '@/components/ui/BrandLoader';
import { apiErrorMessage } from '@/contexts/AuthContext';
import {
  billingService,
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

  async function buyPack(packId: string) {
    setBusy(packId);
    setError(null);
    try {
      const w = await billingService.purchasePack(packId);
      setWallet(w);
      setToast('Créditos adicionados à sua carteira!');
    } catch (err) {
      setError(apiErrorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  async function subscribe(planId: string) {
    setBusy(planId);
    setError(null);
    try {
      const w = await billingService.subscribe(planId);
      setWallet(w);
      setToast('Plano ativado — créditos mensais adicionados!');
    } catch (err) {
      setError(apiErrorMessage(err));
    } finally {
      setBusy(null);
    }
  }

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

      <Typography variant="h6" mb={1.5}>
        Planos mensais
      </Typography>
      <Grid container spacing={2} mb={4}>
        {plans.map((plan) => {
          const current = wallet?.plan === plan.id;
          return (
            <Grid item xs={12} sm={6} md={3} key={plan.id}>
              <Card
                sx={{
                  height: '100%',
                  border: plan.highlight
                    ? '2px solid #fe2c55'
                    : '1px solid rgba(22,24,35,0.08)',
                  position: 'relative',
                }}
              >
                {plan.highlight && (
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
                    {plan.priceBrl === 0
                      ? 'Grátis'
                      : `R$ ${plan.priceBrl.toFixed(2).replace('.', ',')}`}
                    {plan.priceBrl > 0 && (
                      <Typography component="span" variant="body2" color="text.secondary">
                        /mês
                      </Typography>
                    )}
                  </Typography>
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
            <Table size="small">
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
