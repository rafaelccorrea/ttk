import ExpandMoreRoundedIcon from '@mui/icons-material/ExpandMoreRounded';
import HistoryRoundedIcon from '@mui/icons-material/HistoryRounded';
import RefreshRoundedIcon from '@mui/icons-material/RefreshRounded';
import SearchRoundedIcon from '@mui/icons-material/SearchRounded';
import {
  Alert,
  Box,
  Card,
  CardContent,
  Chip,
  Collapse,
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
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { BrandLoader } from '@/components/ui/BrandLoader';
import { apiErrorMessage } from '@/contexts/AuthContext';
import {
  auditService,
  type AuditLog,
  type AuditOpcao,
  type AuditResumo,
} from '@/services/admin.service';
import { dataHora, relativo } from './formato';

const LIMITE = 50;

/** Nome legível das categorias (primeiro segmento da rota). */
const CATEGORIA_LABEL: Record<string, string> = {
  auth: 'Login/cadastro',
  users: 'Perfil',
  billing: 'Cobrança',
  campaigns: 'Fábrica',
  studio: 'Studio',
  live: 'Live Copilot',
  cuts: 'Cortes',
  combinations: 'Multiplicador',
  videogen: 'Geração de vídeo',
  videos: 'Vídeos',
  products: 'Produtos',
  free: 'Free',
  trends: 'Tendências',
  support: 'Suporte',
  admin: 'Administração',
  jobs: 'Jobs (background)',
  ingestion: 'Ingestão',
};

const PERIODOS: Array<{ v: number | ''; label: string }> = [
  { v: '', label: 'Todo o período' },
  { v: 1, label: 'Últimas 24 h' },
  { v: 7, label: 'Últimos 7 dias' },
  { v: 30, label: 'Últimos 30 dias' },
  { v: 90, label: 'Últimos 90 dias' },
];

function categoriaLabel(c: string) {
  return CATEGORIA_LABEL[c] ?? c;
}

function metodoCor(m: string): 'default' | 'success' | 'info' | 'warning' | 'error' {
  if (m === 'DELETE') return 'error';
  if (m === 'PATCH' || m === 'PUT') return 'warning';
  if (m === 'POST') return 'info';
  if (m === 'SYS') return 'default';
  return 'default';
}

/**
 * Trilha de auditoria: tudo que todo usuário fez (login, geração, exclusão,
 * cobrança, ação de admin), com filtros por conta, área, ação, resultado e
 * período. Recebe `userId` para abrir já filtrado a partir do drawer da conta.
 */
export function AuditPanel({ userId: userIdInicial }: { userId?: string | null } = {}) {
  const [items, setItems] = useState<AuditLog[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [busca, setBusca] = useState('');
  const [categoria, setCategoria] = useState('');
  const [acao, setAcao] = useState('');
  const [resultado, setResultado] = useState<'' | 'ok' | 'erro'>('');
  const [quem, setQuem] = useState<'' | 'true' | 'false'>('');
  const [dias, setDias] = useState<number | ''>(7);
  const [userId, setUserId] = useState<string | null>(userIdInicial ?? null);
  const [opcoes, setOpcoes] = useState<AuditOpcao[]>([]);
  const [resumo, setResumo] = useState<AuditResumo | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [atualizando, setAtualizando] = useState(false);
  const [aberto, setAberto] = useState<string | null>(null);
  const primeiraBusca = useRef(true);

  useEffect(() => setUserId(userIdInicial ?? null), [userIdInicial]);

  const carregar = useCallback(async () => {
    try {
      const r = await auditService.listar({
        busca: busca || undefined,
        categoria: categoria || undefined,
        acao: acao || undefined,
        resultado: resultado || undefined,
        admin: quem || undefined,
        userId: userId || undefined,
        desde: dias ? new Date(Date.now() - dias * 86_400_000).toISOString() : undefined,
        page,
        limit: LIMITE,
      });
      setItems(r.items);
      setTotal(r.total);
      setErro(null);
    } catch (e) {
      setErro(apiErrorMessage(e));
    }
  }, [busca, categoria, acao, resultado, quem, userId, dias, page]);

  const carregarTudo = useCallback(async () => {
    setAtualizando(true);
    try {
      const [ops, res] = await Promise.all([
        auditService.opcoes(),
        auditService.resumo(typeof dias === 'number' ? Math.min(dias, 90) : 30),
        carregar(),
      ]);
      setOpcoes(ops);
      setResumo(res);
    } catch (e) {
      setErro(apiErrorMessage(e));
    } finally {
      setCarregando(false);
      setAtualizando(false);
    }
  }, [carregar, dias]);

  useEffect(() => {
    void carregarTudo();
    // Só na montagem: os filtros têm o próprio efeito com debounce abaixo.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (primeiraBusca.current) {
      primeiraBusca.current = false;
      return;
    }
    const t = setTimeout(() => void carregar(), 350);
    return () => clearTimeout(t);
  }, [carregar]);

  const filtrar =
    <T,>(setter: (v: T) => void) =>
    (v: T) => {
      setPage(1);
      setter(v);
    };

  const categorias = useMemo(
    () => Array.from(new Set(opcoes.map((o) => o.categoria))).sort(),
    [opcoes],
  );
  const acoes = useMemo(
    () => opcoes.filter((o) => !categoria || o.categoria === categoria),
    [opcoes, categoria],
  );
  const totalPeriodo = resumo?.porDia.reduce((s, d) => s + d.total, 0) ?? 0;
  const errosPeriodo = resumo?.porDia.reduce((s, d) => s + d.erros, 0) ?? 0;

  if (carregando) return <BrandLoader label="Carregando auditoria..." />;

  return (
    <Card sx={{ borderRadius: 3 }}>
      <CardContent>
        <Stack direction="row" alignItems="center" spacing={1} mb={1.5}>
          <HistoryRoundedIcon color="primary" />
          <Typography fontWeight={800} fontSize={16}>
            Auditoria
          </Typography>
          <Typography fontSize={12.5} color="text.secondary">
            tudo que cada conta fez — logins, gerações, exclusões, cobranças e ações da equipe
          </Typography>
          <Box flex={1} />
          <Tooltip title="Atualizar">
            <span>
              <IconButton size="small" onClick={() => void carregarTudo()} disabled={atualizando}>
                <RefreshRoundedIcon fontSize="small" />
              </IconButton>
            </span>
          </Tooltip>
        </Stack>

        {resumo && (
          <Stack direction="row" spacing={1} mb={2} flexWrap="wrap" useFlexGap alignItems="center">
            <Chip size="small" label={`${totalPeriodo} ações · ${resumo.dias} d`} color="primary" />
            <Chip
              size="small"
              label={`${errosPeriodo} erros`}
              color={errosPeriodo > 0 ? 'error' : 'default'}
              variant={errosPeriodo > 0 ? 'filled' : 'outlined'}
            />
            <Chip size="small" label={`${resumo.usuariosAtivos} contas ativas`} variant="outlined" />
            {resumo.porCategoria.slice(0, 8).map((c) => (
              <Chip
                key={c.categoria}
                size="small"
                variant={categoria === c.categoria ? 'filled' : 'outlined'}
                label={`${categoriaLabel(c.categoria)} ${c.total}`}
                onClick={() => {
                  filtrar(setCategoria)(categoria === c.categoria ? '' : c.categoria);
                  setAcao('');
                }}
              />
            ))}
          </Stack>
        )}

        {erro && (
          <Alert severity="error" sx={{ mb: 2 }} onClose={() => setErro(null)}>
            {erro}
          </Alert>
        )}

        <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.5} mb={2} flexWrap="wrap" useFlexGap>
          <TextField
            size="small"
            placeholder="E-mail, rota, id ou ação"
            value={busca}
            onChange={(e) => filtrar(setBusca)(e.target.value)}
            InputProps={{
              startAdornment: (
                <InputAdornment position="start">
                  <SearchRoundedIcon fontSize="small" />
                </InputAdornment>
              ),
            }}
            sx={{ minWidth: 240 }}
          />
          <TextField
            size="small"
            select
            label="Área"
            value={categoria}
            onChange={(e) => {
              filtrar(setCategoria)(e.target.value);
              setAcao('');
            }}
            sx={{ minWidth: 170 }}
          >
            <MenuItem value="">Todas</MenuItem>
            {categorias.map((c) => (
              <MenuItem key={c} value={c}>
                {categoriaLabel(c)}
              </MenuItem>
            ))}
          </TextField>
          <TextField
            size="small"
            select
            label="Ação"
            value={acao}
            onChange={(e) => filtrar(setAcao)(e.target.value)}
            sx={{ minWidth: 220 }}
          >
            <MenuItem value="">Todas</MenuItem>
            {acoes.map((o) => (
              <MenuItem key={o.acao} value={o.acao}>
                {o.acao} · {o.total}
              </MenuItem>
            ))}
          </TextField>
          <TextField
            size="small"
            select
            label="Resultado"
            value={resultado}
            onChange={(e) => filtrar(setResultado)(e.target.value as '' | 'ok' | 'erro')}
            sx={{ minWidth: 130 }}
          >
            <MenuItem value="">Todos</MenuItem>
            <MenuItem value="ok">Sucesso</MenuItem>
            <MenuItem value="erro">Erro</MenuItem>
          </TextField>
          <TextField
            size="small"
            select
            label="Quem"
            value={quem}
            onChange={(e) => filtrar(setQuem)(e.target.value as '' | 'true' | 'false')}
            sx={{ minWidth: 130 }}
          >
            <MenuItem value="">Todos</MenuItem>
            <MenuItem value="false">Clientes</MenuItem>
            <MenuItem value="true">Equipe</MenuItem>
          </TextField>
          <TextField
            size="small"
            select
            label="Período"
            value={dias}
            onChange={(e) => filtrar(setDias)(e.target.value === '' ? '' : Number(e.target.value))}
            sx={{ minWidth: 160 }}
          >
            {PERIODOS.map((p) => (
              <MenuItem key={String(p.v)} value={p.v}>
                {p.label}
              </MenuItem>
            ))}
          </TextField>
          {userId && (
            <Chip
              label={`conta ${userId.slice(0, 8)}…`}
              onDelete={() => filtrar(setUserId)(null)}
              color="primary"
              variant="outlined"
            />
          )}
        </Stack>

        <Box sx={{ overflowX: 'auto' }}>
          <Table size="small" sx={{ minWidth: 980 }}>
            <TableHead>
              <TableRow>
                <TableCell>Quando</TableCell>
                <TableCell>Conta</TableCell>
                <TableCell>Ação</TableCell>
                <TableCell>Rota</TableCell>
                <TableCell>Resultado</TableCell>
                <TableCell align="right">Tempo</TableCell>
                <TableCell />
              </TableRow>
            </TableHead>
            <TableBody>
              {items.map((l) => {
                const expandido = aberto === l.id;
                return (
                  <TableRow
                    key={l.id}
                    hover
                    sx={{
                      cursor: 'pointer',
                      '& > td': { verticalAlign: 'top' },
                      ...(l.resultado === 'erro' && { bgcolor: 'rgba(211,47,47,0.06)' }),
                    }}
                    onClick={() => setAberto(expandido ? null : l.id)}
                  >
                    <TableCell sx={{ whiteSpace: 'nowrap' }}>
                      <Typography fontSize={13}>{dataHora(l.createdAt)}</Typography>
                      <Typography fontSize={11.5} color="text.secondary">
                        {relativo(l.createdAt)}
                      </Typography>
                    </TableCell>
                    <TableCell>
                      <Stack direction="row" spacing={0.5} alignItems="center">
                        <Typography
                          fontSize={13}
                          sx={{ maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis' }}
                        >
                          {l.userEmail ?? <em style={{ opacity: 0.6 }}>anônimo</em>}
                        </Typography>
                        {l.admin && <Chip size="small" label="equipe" color="secondary" />}
                      </Stack>
                      {l.userId && (
                        <Typography
                          fontSize={11}
                          color="primary"
                          sx={{ cursor: 'pointer' }}
                          onClick={(e) => {
                            e.stopPropagation();
                            filtrar(setUserId)(l.userId);
                          }}
                        >
                          ver só esta conta
                        </Typography>
                      )}
                    </TableCell>
                    <TableCell>
                      <Stack direction="row" spacing={0.5} alignItems="center" flexWrap="wrap" useFlexGap>
                        <Chip size="small" label={l.metodo} color={metodoCor(l.metodo)} sx={{ fontWeight: 700 }} />
                        <Typography fontSize={13} fontFamily="monospace">
                          {l.acao}
                        </Typography>
                      </Stack>
                      <Typography fontSize={11.5} color="text.secondary">
                        {categoriaLabel(l.categoria)}
                      </Typography>
                    </TableCell>
                    <TableCell>
                      <Typography
                        fontSize={12}
                        fontFamily="monospace"
                        sx={{ maxWidth: 280, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                        title={l.rota}
                      >
                        {l.rota}
                      </Typography>
                    </TableCell>
                    <TableCell>
                      <Chip
                        size="small"
                        label={`${l.statusCode} ${l.resultado === 'ok' ? 'ok' : 'erro'}`}
                        color={l.resultado === 'ok' ? 'success' : 'error'}
                        variant={l.resultado === 'ok' ? 'outlined' : 'filled'}
                      />
                      {l.erro && (
                        <Typography fontSize={11.5} color="error" sx={{ maxWidth: 240 }}>
                          {l.erro}
                        </Typography>
                      )}
                    </TableCell>
                    <TableCell align="right" sx={{ whiteSpace: 'nowrap' }}>
                      <Typography fontSize={12.5}>
                        {l.duracaoMs >= 1000 ? `${(l.duracaoMs / 1000).toFixed(1)} s` : `${l.duracaoMs} ms`}
                      </Typography>
                    </TableCell>
                    <TableCell align="right">
                      <ExpandMoreRoundedIcon
                        fontSize="small"
                        sx={{ transform: expandido ? 'rotate(180deg)' : 'none', transition: '0.2s' }}
                      />
                      <Collapse in={expandido} unmountOnExit>
                        <Box
                          onClick={(e) => e.stopPropagation()}
                          sx={{
                            textAlign: 'left',
                            mt: 1,
                            p: 1.5,
                            borderRadius: 2,
                            bgcolor: 'action.hover',
                            width: 'max-content',
                            maxWidth: 520,
                          }}
                        >
                          <Typography fontSize={11.5} color="text.secondary">
                            ip {l.ip ?? '—'} · alvo {l.alvoId ?? '—'} · id {l.id}
                          </Typography>
                          <Typography fontSize={11.5} color="text.secondary" sx={{ wordBreak: 'break-all' }}>
                            {l.userAgent ?? ''}
                          </Typography>
                          <Box
                            component="pre"
                            sx={{ m: 0, mt: 1, fontSize: 11.5, whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}
                          >
                            {l.detalhe ? JSON.stringify(l.detalhe, null, 2) : 'sem corpo'}
                          </Box>
                        </Box>
                      </Collapse>
                    </TableCell>
                  </TableRow>
                );
              })}
              {items.length === 0 && (
                <TableRow>
                  <TableCell colSpan={7}>
                    <Typography py={3} textAlign="center" color="text.secondary">
                      Nenhum evento com esses filtros.
                    </Typography>
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </Box>

        <Stack direction="row" alignItems="center" justifyContent="space-between" mt={1.5}>
          <Typography fontSize={12.5} color="text.secondary">
            {total} evento{total === 1 ? '' : 's'}
          </Typography>
          {total > LIMITE && (
            <Pagination
              count={Math.ceil(total / LIMITE)}
              page={page}
              onChange={(_, p) => setPage(p)}
              size="small"
            />
          )}
        </Stack>
      </CardContent>
    </Card>
  );
}
