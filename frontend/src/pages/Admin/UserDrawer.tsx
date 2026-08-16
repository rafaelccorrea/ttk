import {
  Alert,
  Box,
  Button,
  Chip,
  Divider,
  Drawer,
  MenuItem,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import { useEffect, useState } from 'react';
import { BrandLoader } from '@/components/ui/BrandLoader';
import { apiErrorMessage } from '@/contexts/AuthContext';
import {
  adminService,
  type AdminUserDetail,
} from '@/services/admin.service';
import { billingService, type Plan } from '@/services/billing.service';

const KIND_LABEL: Record<string, string> = {
  signup_bonus: 'Bônus de cadastro',
  plan_grant: 'Créditos do plano',
  purchase: 'Compra / ajuste',
  spend: 'Consumo de IA',
  refund: 'Estorno',
};

/**
 * Ficha da conta, com as duas ações de suporte que sobram no dia a dia:
 * destravar um acesso e corrigir um saldo.
 *
 * As duas exigem confirmação explícita (o motivo é obrigatório no ajuste de
 * crédito) porque mexem no que o cliente pagou — e ficam registradas no extrato
 * dele, para que ninguém precise adivinhar depois de onde veio um saldo.
 */
export function UserDrawer({
  userId,
  onClose,
  onChanged,
}: {
  userId: string | null;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [user, setUser] = useState<AdminUserDetail | null>(null);
  const [planos, setPlanos] = useState<Plan[]>([]);
  const [novoPlano, setNovoPlano] = useState('');
  const [valor, setValor] = useState('');
  const [motivo, setMotivo] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);

  useEffect(() => {
    if (!userId) {
      setUser(null);
      return;
    }
    setErro(null);
    setOk(null);
    Promise.all([adminService.user(userId), billingService.plans()])
      .then(([u, p]) => {
        setUser(u);
        setPlanos(p);
        setNovoPlano(u.plan);
      })
      .catch((e) => setErro(apiErrorMessage(e)));
  }, [userId]);

  async function trocarPlano() {
    if (!user || novoPlano === user.plan) return;
    setSalvando(true);
    setErro(null);
    try {
      const atualizado = await adminService.setPlan(user.id, novoPlano);
      setUser(atualizado);
      setOk(`Plano alterado para ${novoPlano}.`);
      onChanged();
    } catch (e) {
      setErro(apiErrorMessage(e));
    } finally {
      setSalvando(false);
    }
  }

  async function ajustarCreditos() {
    if (!user) return;
    const n = Number(valor);
    if (!Number.isInteger(n) || n === 0) {
      setErro('Informe um número inteiro diferente de zero.');
      return;
    }
    if (!motivo.trim()) {
      setErro('O motivo é obrigatório — ele fica no extrato do cliente.');
      return;
    }
    setSalvando(true);
    setErro(null);
    try {
      const atualizado = await adminService.adjustCredits(
        user.id,
        n,
        motivo.trim(),
      );
      setUser(atualizado);
      setValor('');
      setMotivo('');
      setOk(`${n > 0 ? 'Creditados' : 'Retirados'} ${Math.abs(n)} créditos.`);
      onChanged();
    } catch (e) {
      setErro(apiErrorMessage(e));
    } finally {
      setSalvando(false);
    }
  }

  return (
    <Drawer anchor="right" open={Boolean(userId)} onClose={onClose}>
      <Box sx={{ width: { xs: '100vw', sm: 460 }, p: 3 }}>
        {!user ? (
          erro ? (
            <Alert severity="error">{erro}</Alert>
          ) : (
            <BrandLoader label="Carregando a conta..." />
          )
        ) : (
          <>
            <Typography variant="h6" fontWeight={800}>
              {user.email}
            </Typography>
            <Stack direction="row" spacing={1} mt={1} flexWrap="wrap" useFlexGap>
              <Chip label={user.plan} size="small" color="primary" />
              <Chip label={`${user.credits} créditos`} size="small" />
              {user.isAdmin && <Chip label="admin" size="small" color="secondary" />}
              {!user.emailConfirmed && (
                <Chip label="e-mail não confirmado" size="small" variant="outlined" />
              )}
              {user.stripeCustomerId && (
                <Chip label="tem Stripe" size="small" variant="outlined" />
              )}
            </Stack>

            {erro && (
              <Alert severity="error" sx={{ mt: 2 }}>
                {erro}
              </Alert>
            )}
            {ok && (
              <Alert severity="success" sx={{ mt: 2 }}>
                {ok}
              </Alert>
            )}

            <Divider sx={{ my: 2.5 }} />

            <Typography fontWeight={700} fontSize={14} mb={1}>
              Plano
            </Typography>
            <Stack direction="row" spacing={1}>
              <TextField
                select
                size="small"
                value={novoPlano}
                onChange={(e) => setNovoPlano(e.target.value)}
                sx={{ flex: 1 }}
              >
                <MenuItem value="free">Pagamento pendente (free)</MenuItem>
                {planos.map((p) => (
                  <MenuItem key={p.id} value={p.id}>
                    {p.name}
                  </MenuItem>
                ))}
              </TextField>
              <Button
                variant="outlined"
                disabled={salvando || novoPlano === user.plan}
                onClick={() => void trocarPlano()}
              >
                Aplicar
              </Button>
            </Stack>
            <Typography fontSize={11.5} color="text.secondary" mt={0.75}>
              Não mexe na assinatura do Stripe — se houver uma ativa, a próxima
              renovação prevalece.
            </Typography>

            <Divider sx={{ my: 2.5 }} />

            <Typography fontWeight={700} fontSize={14} mb={1}>
              Ajustar créditos
            </Typography>
            <Stack spacing={1}>
              <TextField
                size="small"
                label="Quantidade (negativo retira)"
                value={valor}
                onChange={(e) => setValor(e.target.value)}
                placeholder="ex.: 100 ou -50"
              />
              <TextField
                size="small"
                label="Motivo (vai para o extrato do cliente)"
                value={motivo}
                onChange={(e) => setMotivo(e.target.value)}
              />
              <Button
                variant="contained"
                disabled={salvando}
                onClick={() => void ajustarCreditos()}
              >
                Lançar ajuste
              </Button>
            </Stack>

            <Divider sx={{ my: 2.5 }} />

            <Typography fontWeight={700} fontSize={14} mb={1}>
              Extrato ({user.historico.length})
            </Typography>
            <Stack spacing={1}>
              {user.historico.map((t) => (
                <Stack
                  key={t.id}
                  direction="row"
                  justifyContent="space-between"
                  alignItems="flex-start"
                  sx={{ borderBottom: '1px solid rgba(22,24,35,0.06)', pb: 0.75 }}
                >
                  <Box sx={{ pr: 1 }}>
                    <Typography fontSize={13}>
                      {KIND_LABEL[t.kind] ?? t.kind}
                    </Typography>
                    <Typography fontSize={11.5} color="text.secondary">
                      {t.description ?? t.action ?? '—'}
                    </Typography>
                    <Typography fontSize={11} color="text.secondary">
                      {new Date(t.createdAt).toLocaleString('pt-BR')}
                    </Typography>
                  </Box>
                  <Typography
                    fontSize={13}
                    fontWeight={800}
                    color={t.amount >= 0 ? '#0a9c97' : '#fe2c55'}
                  >
                    {t.amount >= 0 ? '+' : ''}
                    {t.amount}
                  </Typography>
                </Stack>
              ))}
              {user.historico.length === 0 && (
                <Typography fontSize={13} color="text.secondary">
                  Nenhum lançamento ainda.
                </Typography>
              )}
            </Stack>
          </>
        )}
      </Box>
    </Drawer>
  );
}
