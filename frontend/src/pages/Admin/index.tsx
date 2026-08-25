import RefreshRoundedIcon from '@mui/icons-material/RefreshRounded';
import SearchRoundedIcon from '@mui/icons-material/SearchRounded';
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  Grid,
  IconButton,
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
  Tooltip,
  Typography,
} from '@mui/material';
import { useCallback, useEffect, useState } from 'react';
import { BrandLoader } from '@/components/ui/BrandLoader';
import { apiErrorMessage } from '@/contexts/AuthContext';
import {
  adminService,
  type AdminOrdenar,
  type AdminOverview,
  type AdminSituacao,
  type AdminUser,
} from '@/services/admin.service';
import { SupportPanel } from './SupportPanel';
import { UserDrawer } from './UserDrawer';
import { PLANO_COR, brl, data, dataHora, diasDesde, relativo } from './formato';

const LIMITE = 25;

const SITUACOES: Array<{ id: AdminSituacao | ''; label: string }> = [
  { id: '', label: 'Todas' },
  { id: 'ativos_7d', label: 'Ativas nos últimos 7 dias' },
  { id: 'inativos_30d', label: 'Sem acesso há 30+ dias' },
  { id: 'nunca_usou', label: 'Nunca gastaram crédito' },
  { id: 'nao_confirmado', label: 'E-mail não confirmado' },
  { id: 'confirmado', label: 'E-mail confirmado' },
  { id: 'google', label: 'Com Google' },
  { id: 'stripe', label: 'Com Stripe' },
  { id: 'fila', label: 'Na fila de espera' },
];

const ORDENS: Array<{ id: AdminOrdenar; label: string }> = [
  { id: 'cadastro', label: 'Cadastro' },
  { id: 'ultimo_acesso', label: 'Último acesso' },
  { id: 'gastos', label: 'Créditos gastos' },
  { id: 'creditos', label: 'Saldo' },
  { id: 'email', label: 'E-mail' },
];

/**
 * Painel administrativo: quem entrou, quem voltou, quem pagou e o que cada
 * conta produziu.
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
  const [situacao, setSituacao] = useState<AdminSituacao | ''>('');
  const [cadastroDias, setCadastroDias] = useState<number | ''>('');
  const [ordenar, setOrdenar] = useState<AdminOrdenar>('cadastro');
  const [direcao, setDirecao] = useState<'asc' | 'desc'>('desc');
  const [erro, setErro] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [atualizando, setAtualizando] = useState(false);
  const [aberto, setAberto] = useState<string | null>(null);

  const carregarUsuarios = useCallback(async () => {
    try {
      const r = await adminService.users({
        busca: busca || undefined,
        plano: plano || undefined,
        situacao: situacao || undefined,
        cadastroDias: cadastroDias || undefined,
        ordenar,
        direcao,
        page,
        limit: LIMITE,
      });
      setUsers(r.items);
      setTotal(r.total);
    } catch (e) {
      setErro(apiErrorMessage(e));
    }
  }, [busca, plano, situacao, cadastroDias, ordenar, direcao, page]);

  const carregarTudo = useCallback(async () => {
    setAtualizando(true);
    try {
      setOverview(await adminService.overview());
      await carregarUsuarios();
      setErro(null);
    } catch (e) {
      setErro(apiErrorMessage(e));
    } finally {
      setCarregando(false);
      setAtualizando(false);
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
  }, [carregarUsuarios]);

  const filtrar = <T,>(setter: (v: T) => void) => (v: T) => {
    setPage(1);
    setter(v);
  };

  if (carregando) return <BrandLoader label="Carregando o painel..." />;

  const c = overview?.contas;

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
            Contas, acesso, assinaturas e consumo de IA.
          </Typography>
        </Box>
        <Tooltip title="Recarregar números e lista">
          <span>
            <IconButton onClick={() => void carregarTudo()} disabled={atualizando}>
              <RefreshRoundedIcon />
            </IconButton>
          </span>
        </Tooltip>
      </Stack>

      {erro && (
        <Alert severity="error" sx={{ mb: 3 }}>
          {erro}
        </Alert>
      )}

      {overview && c && (
        <>
          <Secao titulo="Contas e acesso" />
          <Grid container spacing={2} mb={3}>
            <Metric titulo="Contas" valor={String(c.total)} nota={`${c.cortesia} de cortesia (equipe)`} />
            <Metric
              titulo="Novos"
              valor={String(c.novos7Dias)}
              nota={`últimos 7 dias · ${c.novos30Dias} em 30 dias`}
            />
            <Metric
              titulo="Ativos"
              valor={String(c.ativos7Dias)}
              nota={`abriram o app em 7 dias · ${c.ativos30Dias} em 30`}
              destaque
            />
            <Metric
              titulo="Não confirmaram"
              valor={String(c.naoConfirmaram)}
              nota="cadastro por e-mail sem confirmar"
              alerta={c.naoConfirmaram > 0}
            />
            <Metric
              titulo="Sem uso"
              valor={String(c.semUso)}
              nota="7+ dias de casa e zero crédito gasto"
              alerta={c.semUso > 0}
            />
            <Metric titulo="Com Google" valor={String(c.viaGoogle)} nota="login social vinculado" />
            <Grid item xs={12} sm={8} md={6}>
              <Card sx={{ borderRadius: 3, height: '100%' }}>
                <CardContent sx={{ py: 2, px: { xs: 1.5, sm: 2 } }}>
                  <Typography fontSize={12} color="text.secondary" fontWeight={700}>
                    CADASTROS POR DIA · 14 DIAS
                  </Typography>
                  <Stack direction="row" spacing={0.5} mt={1} flexWrap="wrap" useFlexGap>
                    {overview.cadastrosPorDia.map((d) => (
                      <Tooltip
                        key={d.dia}
                        title={`${new Date(`${d.dia}T12:00:00`).toLocaleDateString('pt-BR')}: ${d.total} cadastro(s)`}
                      >
                        <Chip
                          size="small"
                          label={d.total}
                          color={d.total > 0 ? 'primary' : 'default'}
                          variant={d.total > 0 ? 'filled' : 'outlined'}
                          sx={{ minWidth: 34, fontWeight: 700 }}
                        />
                      </Tooltip>
                    ))}
                  </Stack>
                  <Typography fontSize={11.5} color="text.secondary" mt={0.75}>
                    do mais antigo (esquerda) até hoje (direita)
                  </Typography>
                </CardContent>
              </Card>
            </Grid>
          </Grid>

          <Secao titulo="Receita e créditos" />
          <Grid container spacing={2} mb={3}>
            <Metric
              titulo="Pagantes"
              valor={String(c.pagantes)}
              nota="assinatura ativa no Stripe"
              destaque
            />
            <Metric titulo="Pagamento pendente" valor={String(c.pendentes)} nota="plano free" />
            <Metric
              titulo="Conversão"
              valor={`${c.conversaoPct}%`}
              nota="pagantes ÷ contas externas"
            />
            <Metric
              titulo="Receita total"
              valor={overview.receita.fonte === 'stripe' ? brl(overview.receita.totalBrl) : '—'}
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
                overview.receita.fonte === 'stripe' ? brl(overview.receita.ultimos30DiasBrl) : '—'
              }
              nota="cobrado, menos reembolsos"
            />
            <Metric
              titulo="Créditos gastos (30d)"
              valor={overview.creditos.gastos30Dias.toLocaleString('pt-BR')}
              nota={`valor de face ≈ ${brl(overview.creditos.custoEstimado30DiasBrl)}`}
            />
            <Metric
              titulo="Créditos em circulação"
              valor={overview.creditos.emCirculacao.toLocaleString('pt-BR')}
              nota="passivo a entregar"
            />
          </Grid>

          <Stack direction="row" spacing={1} mb={3} flexWrap="wrap" useFlexGap alignItems="center">
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
                onClick={() => filtrar(setPlano)(plano === p.id ? '' : p.id)}
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

      <SupportPanel />

      <Card sx={{ borderRadius: 3 }}>
        <CardContent>
          <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.5} mb={2} flexWrap="wrap" useFlexGap>
            <TextField
              size="small"
              placeholder="Buscar por e-mail ou nome"
              value={busca}
              onChange={(e) => filtrar(setBusca)(e.target.value)}
              InputProps={{
                startAdornment: (
                  <InputAdornment position="start">
                    <SearchRoundedIcon fontSize="small" />
                  </InputAdornment>
                ),
              }}
              sx={{ flex: 1, minWidth: { md: 240 } }}
            />
            <TextField
              select
              size="small"
              label="Plano"
              value={plano}
              onChange={(e) => filtrar(setPlano)(e.target.value)}
              sx={{ minWidth: { xs: 0, md: 160 } }}
            >
              <MenuItem value="">Todos</MenuItem>
              <MenuItem value="free">Pagamento pendente</MenuItem>
              {overview?.porPlano.map((p) => (
                <MenuItem key={p.id} value={p.id}>
                  {p.nome}
                </MenuItem>
              ))}
            </TextField>
            <TextField
              select
              size="small"
              label="Situação"
              value={situacao}
              onChange={(e) => filtrar(setSituacao)(e.target.value as AdminSituacao | '')}
              sx={{ minWidth: { xs: 0, md: 220 } }}
            >
              {SITUACOES.map((s) => (
                <MenuItem key={s.id} value={s.id}>
                  {s.label}
                </MenuItem>
              ))}
            </TextField>
            <TextField
              select
              size="small"
              label="Cadastro"
              value={cadastroDias}
              onChange={(e) => filtrar(setCadastroDias)(e.target.value === '' ? '' : Number(e.target.value))}
              sx={{ minWidth: { xs: 0, md: 150 } }}
            >
              <MenuItem value="">Qualquer data</MenuItem>
              <MenuItem value={7}>Últimos 7 dias</MenuItem>
              <MenuItem value={30}>Últimos 30 dias</MenuItem>
              <MenuItem value={90}>Últimos 90 dias</MenuItem>
            </TextField>
            <Stack direction="row" spacing={1}>
              <TextField
                select
                size="small"
                label="Ordenar por"
                value={ordenar}
                onChange={(e) => filtrar(setOrdenar)(e.target.value as AdminOrdenar)}
                sx={{ minWidth: 150, flex: 1 }}
              >
                {ORDENS.map((o) => (
                  <MenuItem key={o.id} value={o.id}>
                    {o.label}
                  </MenuItem>
                ))}
              </TextField>
              <Button
                size="small"
                variant="outlined"
                onClick={() => filtrar(setDirecao)(direcao === 'desc' ? 'asc' : 'desc')}
                sx={{ whiteSpace: 'nowrap', flexShrink: 0 }}
              >
                {direcao === 'desc' ? '↓ desc' : '↑ asc'}
              </Button>
            </Stack>
          </Stack>

          <Typography fontSize={12.5} color="text.secondary" mb={1}>
            {total.toLocaleString('pt-BR')} conta(s)
            {busca || plano || situacao || cadastroDias ? ' com esse filtro' : ''}
          </Typography>

          <Box sx={{ overflowX: 'auto' }}>
            <Table size="small" sx={{ minWidth: 980 }}>
              <TableHead>
                <TableRow>
                  <TableCell>Conta</TableCell>
                  <TableCell>Plano</TableCell>
                  <TableCell align="right">Saldo</TableCell>
                  <TableCell align="right">Gastos</TableCell>
                  <TableCell>Uso</TableCell>
                  <TableCell>Cadastro</TableCell>
                  <TableCell>Último acesso</TableCell>
                  <TableCell />
                </TableRow>
              </TableHead>
              <TableBody>
                {users.map((u) => (
                  <TableRow
                    key={u.id}
                    hover
                    onClick={() => setAberto(u.id)}
                    sx={{ cursor: 'pointer' }}
                  >
                    <TableCell>
                      <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
                        <Box sx={{ minWidth: 0 }}>
                          <Typography fontSize={13.5} fontWeight={600} sx={{ wordBreak: 'break-word' }}>
                            {u.email}
                          </Typography>
                          {u.displayName && (
                            <Typography fontSize={12} color="text.secondary">
                              {u.displayName}
                            </Typography>
                          )}
                        </Box>
                        {u.isAdmin && <Chip label="admin" size="small" color="secondary" />}
                        {u.cortesia && !u.isAdmin && (
                          <Chip label="cortesia" size="small" color="secondary" variant="outlined" />
                        )}
                        {u.viaGoogle && (
                          <Chip label="Google" size="small" variant="outlined" color="info" />
                        )}
                        {!u.emailConfirmed && !u.viaGoogle && (
                          <Chip label="não confirmou" size="small" variant="outlined" color="warning" />
                        )}
                        {u.naFila && <Chip label="na fila" size="small" variant="outlined" />}
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
                      {u.liveMinutes > 0 && (
                        <Typography fontSize={11} color="text.secondary">
                          {u.liveMinutes} min live
                        </Typography>
                      )}
                    </TableCell>
                    <TableCell align="right">
                      {u.creditosGastos.toLocaleString('pt-BR')}
                      {u.ultimoUso && (
                        <Typography fontSize={11} color="text.secondary">
                          {relativo(u.ultimoUso)}
                        </Typography>
                      )}
                    </TableCell>
                    <TableCell>
                      <Uso uso={u.uso} />
                    </TableCell>
                    <TableCell>
                      <Tooltip title={dataHora(u.createdAt)}>
                        <Box>
                          <Typography fontSize={13}>{data(u.createdAt)}</Typography>
                          <Typography fontSize={11} color="text.secondary">
                            {relativo(u.createdAt)}
                          </Typography>
                        </Box>
                      </Tooltip>
                    </TableCell>
                    <TableCell>
                      <UltimoAcesso iso={u.lastSeenAt} />
                    </TableCell>
                    <TableCell align="right">
                      <Button
                        size="small"
                        onClick={(e) => {
                          e.stopPropagation();
                          setAberto(u.id);
                        }}
                      >
                        Abrir
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
                {users.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={8}>
                      <Typography color="text.secondary" fontSize={14} py={3} textAlign="center">
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

/** Contadores compactos do que a conta produziu — diz se o cadastro virou uso. */
function Uso({ uso }: { uso: AdminUser['uso'] }) {
  const itens: Array<[number, string, string]> = [
    [uso.produtos, 'produto(s)', 'P'],
    [uso.campanhas, 'campanha(s)', 'C'],
    [uso.videosGerados, 'vídeo(s) gerado(s)', 'V'],
    [uso.lives, 'live(s)', 'L'],
  ];
  const nada = itens.every(([n]) => n === 0);
  if (nada) {
    return (
      <Typography fontSize={12} color="text.secondary">
        sem uso
      </Typography>
    );
  }
  return (
    <Stack direction="row" spacing={0.5}>
      {itens.map(([n, nome, sigla]) => (
        <Tooltip key={sigla} title={`${n} ${nome}`}>
          <Chip
            size="small"
            label={`${sigla} ${n}`}
            variant={n > 0 ? 'filled' : 'outlined'}
            color={n > 0 ? 'default' : 'default'}
            sx={{ fontWeight: 700, opacity: n > 0 ? 1 : 0.45, fontFamily: 'monospace' }}
          />
        </Tooltip>
      ))}
    </Stack>
  );
}

/** "há 2 h" em verde, "há 40 dias" em vermelho, "nunca" apagado. */
function UltimoAcesso({ iso }: { iso: string | null }) {
  const dias = diasDesde(iso);
  const cor =
    dias === null ? 'text.disabled' : dias <= 7 ? 'success.main' : dias <= 30 ? 'text.primary' : 'error.main';
  return (
    <Tooltip title={iso ? dataHora(iso) : 'Nunca abriu o app depois do cadastro (ou antes de existir este registro).'}>
      <Typography fontSize={13} fontWeight={dias !== null && dias <= 7 ? 700 : 400} sx={{ color: cor }}>
        {relativo(iso)}
      </Typography>
    </Tooltip>
  );
}

function Secao({ titulo }: { titulo: string }) {
  return (
    <Typography fontSize={12.5} color="text.secondary" fontWeight={700} mb={1}>
      {titulo.toUpperCase()}
    </Typography>
  );
}

function Metric({
  titulo,
  valor,
  nota,
  destaque,
  alerta,
}: {
  titulo: string;
  valor: string;
  nota?: string;
  destaque?: boolean;
  alerta?: boolean;
}) {
  return (
    <Grid item xs={6} sm={4} md={3}>
      <Card
        sx={{
          borderRadius: 3,
          height: '100%',
          border: destaque ? '1px solid #fe2c5566' : alerta ? '1px solid #ed6c0266' : undefined,
        }}
      >
        <CardContent sx={{ py: 2, px: { xs: 1.5, sm: 2 } }}>
          <Typography fontSize={12} color="text.secondary" fontWeight={700}>
            {titulo.toUpperCase()}
          </Typography>
          <Typography
            fontSize={{ xs: 20, sm: 24 }}
            fontWeight={800}
            lineHeight={1.3}
            sx={{ wordBreak: 'break-word', color: alerta ? 'warning.main' : undefined }}
          >
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
