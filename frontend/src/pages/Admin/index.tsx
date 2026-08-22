import SearchRoundedIcon from '@mui/icons-material/SearchRounded';
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  Grid,
  InputAdornment,
  MenuItem,
  Pagination,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from '@mui/material';
import { useCallback, useEffect, useState } from 'react';
import { BrandLoader } from '@/components/ui/BrandLoader';
import { apiErrorMessage } from '@/contexts/AuthContext';
import {
  adminService,
  type AdminOverview,
  type AdminUser,
} from '@/services/admin.service';
import { UserDrawer } from './UserDrawer';

const PLANO_COR: Record<string, 'default' | 'success' | 'info' | 'warning'> = {
  free: 'warning',
  essencial: 'info',
  pro: 'success',
  business: 'success',
};

const LIMITE = 25;

function brl(v: number) {
  return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function data(iso: string | null) {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString('pt-BR');
}

/**
 * Painel administrativo: quem entrou, quem pagou e quanto de IA foi consumido.
 *
 * A tela é de leitura em primeiro lugar — as ações de escrita (trocar plano,
 * ajustar crédito) ficam na ficha de cada conta, um clique adiante, porque são
 * exceções de suporte e não a operação do dia a dia.
 */
export function AdminPage() {
  const [overview, setOverview] = useState<AdminOverview | null>(null);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [busca, setBusca] = useState('');
  const [plano, setPlano] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [aberto, setAberto] = useState<string | null>(null);

  const carregarUsuarios = useCallback(async () => {
    try {
      const r = await adminService.users({
        busca: busca || undefined,
        plano: plano || undefined,
        page,
        limit: LIMITE,
      });
      setUsers(r.items);
      setTotal(r.total);
    } catch (e) {
      setErro(apiErrorMessage(e));
    }
  }, [busca, plano, page]);

  const carregarTudo = useCallback(async () => {
    try {
      setOverview(await adminService.overview());
      await carregarUsuarios();
    } catch (e) {
      setErro(apiErrorMessage(e));
    } finally {
      setCarregando(false);
    }
  }, [carregarUsuarios]);

  useEffect(() => {
    void carregarTudo();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // A busca espera a digitação parar: sem isso, cada tecla vira uma consulta.
  useEffect(() => {
    const t = setTimeout(() => void carregarUsuarios(), 350);
    return () => clearTimeout(t);
  }, [busca, plano, page, carregarUsuarios]);

  if (carregando) return <BrandLoader label="Carregando o painel..." />;

  return (
    <>
      <Stack
        direction="row"
        alignItems="center"
        justifyContent="space-between"
        mb={3}
        flexWrap="wrap"
        gap={1}
      >
        <Box>
          <Typography variant="h5" fontWeight={800}>
            Administração
          </Typography>
          <Typography color="text.secondary" fontSize={14}>
            Contas, assinaturas e consumo de IA.
          </Typography>
        </Box>
      </Stack>

      {erro && (
        <Alert severity="error" sx={{ mb: 3 }}>
          {erro}
        </Alert>
      )}

      {overview && (
        <>
          <Grid container spacing={2} mb={3}>
            <Metric titulo="Contas" valor={String(overview.contas.total)} />
            <Metric
              titulo="Pagantes"
              valor={String(overview.contas.pagantes)}
              nota="assinatura ativa no Stripe"
              destaque
            />
            <Metric
              titulo="Pagamento pendente"
              valor={String(overview.contas.pendentes)}
            />
            <Metric
              titulo="Conversão"
              valor={`${overview.contas.conversaoPct}%`}
              nota="pagantes ÷ contas externas"
            />
            <Metric
              titulo="Receita total"
              valor={
                overview.receita.fonte === 'stripe'
                  ? brl(overview.receita.totalBrl)
                  : '—'
              }
              nota={
                overview.receita.fonte === 'stripe'
                  ? `${overview.receita.cobrancas} cobrança(s) no Stripe`
                  : 'Stripe indisponível'
              }
              destaque
            />
            <Metric
              titulo="Receita (30d)"
              valor={
                overview.receita.fonte === 'stripe'
                  ? brl(overview.receita.ultimos30DiasBrl)
                  : '—'
              }
              nota="cobrado, menos reembolsos"
            />
            <Metric
              titulo="Novos (30d)"
              valor={String(overview.contas.novos30Dias)}
            />
            <Metric
              titulo="Com Google"
              valor={String(overview.contas.viaGoogle)}
              nota="contas com login social vinculado"
            />
            <Metric
              titulo="Acesso de cortesia"
              valor={String(overview.contas.cortesia)}
              nota="equipe — não conta como venda"
            />
            <Metric
              titulo="Créditos gastos (30d)"
              valor={overview.creditos.gastos30Dias.toLocaleString('pt-BR')}
              nota={`custo ≈ ${brl(overview.creditos.custoEstimado30DiasBrl)}`}
            />
            <Metric
              titulo="Créditos em circulação"
              valor={overview.creditos.emCirculacao.toLocaleString('pt-BR')}
              nota="passivo a entregar"
            />
          </Grid>

          <Stack
            direction="row"
            spacing={1}
            mb={3}
            flexWrap="wrap"
            useFlexGap
            alignItems="center"
          >
            <Typography fontSize={12.5} color="text.secondary" fontWeight={700}>
              CONTAS COM PLANO LIBERADO
            </Typography>
            {overview.porPlano.map((p) => (
              <Chip
                key={p.id}
                label={`${p.nome}: ${p.assinantes}`}
                color={p.assinantes > 0 ? 'primary' : 'default'}
                variant={p.assinantes > 0 ? 'filled' : 'outlined'}
                sx={{ fontWeight: 700 }}
              />
            ))}
            {/* Deixa explícito que este bloco conta permissão, não venda: aqui
                entram as contas de cortesia e as liberadas pelo suporte. */}
            <Typography fontSize={11.5} color="text.secondary">
              inclui cortesia e liberações manuais — venda é "Pagantes"
            </Typography>
          </Stack>
        </>
      )}

      <Card sx={{ borderRadius: 3 }}>
        <CardContent>
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} mb={2}>
            <TextField
              size="small"
              placeholder="Buscar por e-mail ou nome"
              value={busca}
              onChange={(e) => {
                setPage(1);
                setBusca(e.target.value);
              }}
              InputProps={{
                startAdornment: (
                  <InputAdornment position="start">
                    <SearchRoundedIcon fontSize="small" />
                  </InputAdornment>
                ),
              }}
              sx={{ flex: 1 }}
            />
            <TextField
              select
              size="small"
              label="Plano"
              value={plano}
              onChange={(e) => {
                setPage(1);
                setPlano(e.target.value);
              }}
              sx={{ minWidth: 180 }}
            >
              <MenuItem value="">Todos</MenuItem>
              <MenuItem value="free">Pagamento pendente</MenuItem>
              {overview?.porPlano.map((p) => (
                <MenuItem key={p.id} value={p.id}>
                  {p.nome}
                </MenuItem>
              ))}
            </TextField>
          </Stack>

          <Box sx={{ overflowX: 'auto' }}>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Conta</TableCell>
                  <TableCell>Plano</TableCell>
                  <TableCell align="right">Créditos</TableCell>
                  <TableCell align="right">Gastos</TableCell>
                  <TableCell>Cadastro</TableCell>
                  <TableCell>Último uso</TableCell>
                  <TableCell />
                </TableRow>
              </TableHead>
              <TableBody>
                {users.map((u) => (
                  <TableRow key={u.id} hover>
                    <TableCell>
                      <Stack direction="row" spacing={1} alignItems="center">
                        <Box>
                          <Typography fontSize={13.5} fontWeight={600}>
                            {u.email}
                          </Typography>
                          {u.displayName && (
                            <Typography fontSize={12} color="text.secondary">
                              {u.displayName}
                            </Typography>
                          )}
                        </Box>
                        {u.isAdmin && (
                          <Chip label="admin" size="small" color="secondary" />
                        )}
                        {u.viaGoogle && (
                          <Chip
                            label="Google"
                            size="small"
                            variant="outlined"
                            color="info"
                          />
                        )}
                        {!u.emailConfirmed && (
                          <Chip
                            label="não confirmou"
                            size="small"
                            variant="outlined"
                          />
                        )}
                        {u.naFila && (
                          <Chip label="na fila" size="small" variant="outlined" />
                        )}
                      </Stack>
                    </TableCell>
                    <TableCell>
                      <Chip
                        label={u.plan}
                        size="small"
                        color={PLANO_COR[u.plan] ?? 'default'}
                        sx={{ fontWeight: 700 }}
                      />
                      {u.temAssinaturaStripe && (
                        <Typography fontSize={11} color="text.secondary">
                          Stripe
                        </Typography>
                      )}
                    </TableCell>
                    <TableCell align="right">
                      {u.credits.toLocaleString('pt-BR')}
                    </TableCell>
                    <TableCell align="right">
                      {u.creditosGastos.toLocaleString('pt-BR')}
                    </TableCell>
                    <TableCell>{data(u.createdAt)}</TableCell>
                    <TableCell>{data(u.ultimoUso)}</TableCell>
                    <TableCell align="right">
                      <Button size="small" onClick={() => setAberto(u.id)}>
                        Abrir
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
                {users.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={7}>
                      <Typography
                        color="text.secondary"
                        fontSize={14}
                        py={3}
                        textAlign="center"
                      >
                        Nenhuma conta encontrada com esse filtro.
                      </Typography>
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </Box>

          {total > LIMITE && (
            <Stack alignItems="center" mt={2}>
              <Pagination
                count={Math.ceil(total / LIMITE)}
                page={page}
                onChange={(_, p) => setPage(p)}
                size="small"
              />
            </Stack>
          )}
        </CardContent>
      </Card>

      <UserDrawer
        userId={aberto}
        onClose={() => setAberto(null)}
        onChanged={() => void carregarTudo()}
      />
    </>
  );
}

function Metric({
  titulo,
  valor,
  nota,
  destaque,
}: {
  titulo: string;
  valor: string;
  nota?: string;
  destaque?: boolean;
}) {
  return (
    <Grid item xs={6} sm={4} md={3}>
      <Card
        sx={{
          borderRadius: 3,
          height: '100%',
          border: destaque ? '1px solid #fe2c5566' : undefined,
        }}
      >
        <CardContent sx={{ py: 2 }}>
          <Typography fontSize={12} color="text.secondary" fontWeight={700}>
            {titulo.toUpperCase()}
          </Typography>
          <Typography fontSize={24} fontWeight={800} lineHeight={1.3}>
            {valor}
          </Typography>
          {nota && (
            <Typography fontSize={11.5} color="text.secondary">
              {nota}
            </Typography>
          )}
        </CardContent>
      </Card>
    </Grid>
  );
}
