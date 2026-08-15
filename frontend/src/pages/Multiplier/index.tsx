import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  Collapse,
  Divider,
  Grid,
  IconButton,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Tooltip,
  Typography,
} from '@mui/material';
import AddRoundedIcon from '@mui/icons-material/AddRounded';
import CloseRoundedIcon from '@mui/icons-material/CloseRounded';
import ContentCopyRoundedIcon from '@mui/icons-material/ContentCopyRounded';
import DeleteOutlineRoundedIcon from '@mui/icons-material/DeleteOutlineRounded';
import DownloadRoundedIcon from '@mui/icons-material/DownloadRounded';
import DynamicFeedRoundedIcon from '@mui/icons-material/DynamicFeedRounded';
import ExpandLessRoundedIcon from '@mui/icons-material/ExpandLessRounded';
import ExpandMoreRoundedIcon from '@mui/icons-material/ExpandMoreRounded';
import { FormEvent, useEffect, useMemo, useState } from 'react';
import {
  Combination,
  CombinationPlanDetail,
  CombinationPlanSummary,
  PlanFormat,
  combinationsService,
} from '@/services/combinations.service';

const LIMITS = { hooks: 10, bodies: 5, ctas: 3 } as const;

function truncate(text: string, max = 30) {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

interface ClipListProps {
  title: string;
  emoji: string;
  items: string[];
  max: number;
  onChange: (items: string[]) => void;
  placeholder: string;
}

function ClipList({ title, emoji, items, max, onChange, placeholder }: ClipListProps) {
  return (
    <Box sx={{ mb: 2 }}>
      <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 1 }}>
        <Typography variant="subtitle2">
          {emoji} {title}
        </Typography>
        <Chip size="small" label={`${items.length}/${max}`} variant="outlined" />
      </Stack>
      <Stack spacing={1}>
        {items.map((value, index) => (
          <Stack key={index} direction="row" spacing={1} alignItems="center">
            <TextField
              fullWidth
              size="small"
              value={value}
              placeholder={placeholder}
              inputProps={{ maxLength: 80 }}
              onChange={(e) => {
                const next = [...items];
                next[index] = e.target.value;
                onChange(next);
              }}
            />
            <IconButton
              size="small"
              aria-label="Remover clipe"
              disabled={items.length === 1}
              onClick={() => onChange(items.filter((_item, i) => i !== index))}
            >
              <CloseRoundedIcon fontSize="small" />
            </IconButton>
          </Stack>
        ))}
      </Stack>
      <Button
        size="small"
        startIcon={<AddRoundedIcon />}
        disabled={items.length >= max}
        onClick={() => onChange([...items, ''])}
        sx={{ mt: 1 }}
      >
        Adicionar
      </Button>
    </Box>
  );
}

export function MultiplierPage() {
  const [sigla, setSigla] = useState('');
  const [format, setFormat] = useState<PlanFormat>('9:16');
  const [hooks, setHooks] = useState<string[]>(['']);
  const [bodies, setBodies] = useState<string[]>(['']);
  const [ctas, setCtas] = useState<string[]>(['']);

  const [result, setResult] = useState<CombinationPlanDetail | null>(null);
  const [plans, setPlans] = useState<CombinationPlanSummary[]>([]);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [expandedDetail, setExpandedDetail] = useState<CombinationPlanDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    combinationsService.list().then(setPlans).catch(console.error);
  }, []);

  const counts = useMemo(
    () => ({
      hooks: hooks.filter((h) => h.trim()).length,
      bodies: bodies.filter((b) => b.trim()).length,
      ctas: ctas.filter((c) => c.trim()).length,
    }),
    [hooks, bodies, ctas],
  );
  const total = counts.hooks * counts.bodies * counts.ctas;

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const plan = await combinationsService.create({
        sigla: sigla.trim().toUpperCase(),
        format,
        hooks: hooks.map((h) => h.trim()).filter(Boolean),
        bodies: bodies.map((b) => b.trim()).filter(Boolean),
        ctas: ctas.map((c) => c.trim()).filter(Boolean),
      });
      setResult(plan);
      setPlans((prev) => [
        { ...plan, total: plan.combinations.length },
        ...prev,
      ]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao gerar combinações');
    } finally {
      setBusy(false);
    }
  }

  async function handleCopy(combinations: Combination[]) {
    await navigator.clipboard.writeText(combinations.map((c) => c.filename).join('\n'));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  function handleDownloadCsv(plan: CombinationPlanDetail) {
    const rows = [
      'code;filename;hook;body;cta',
      ...plan.combinations.map((c) => [c.code, c.filename, c.hook, c.body, c.cta].join(';')),
    ];
    const blob = new Blob(['﻿' + rows.join('\n')], {
      type: 'text/csv;charset=utf-8',
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${plan.sigla}_combinacoes.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }

  async function handleToggleExpand(id: string) {
    if (expanded === id) {
      setExpanded(null);
      setExpandedDetail(null);
      return;
    }
    setExpanded(id);
    setExpandedDetail(null);
    try {
      setExpandedDetail(await combinationsService.findOne(id));
    } catch (err) {
      console.error(err);
    }
  }

  async function handleDeletePlan(id: string) {
    await combinationsService.delete(id);
    setPlans((prev) => prev.filter((p) => p.id !== id));
    if (expanded === id) {
      setExpanded(null);
      setExpandedDetail(null);
    }
    if (result?.id === id) setResult(null);
  }

  function renderCombinationsTable(combinations: Combination[]) {
    return (
      <Box sx={{ overflowX: 'auto' }}>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Código</TableCell>
              <TableCell>Arquivo</TableCell>
              <TableCell>Gancho</TableCell>
              <TableCell>Corpo</TableCell>
              <TableCell>CTA</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {combinations.map((c) => (
              <TableRow key={c.code} hover>
                <TableCell>
                  <Chip size="small" color="primary" variant="outlined" label={c.code} />
                </TableCell>
                <TableCell sx={{ fontFamily: 'monospace', fontSize: 12 }}>{c.filename}</TableCell>
                <TableCell>
                  <Tooltip title={c.hook}>
                    <span>{truncate(c.hook)}</span>
                  </Tooltip>
                </TableCell>
                <TableCell>
                  <Tooltip title={c.body}>
                    <span>{truncate(c.body)}</span>
                  </Tooltip>
                </TableCell>
                <TableCell>
                  <Tooltip title={c.cta}>
                    <span>{truncate(c.cta)}</span>
                  </Tooltip>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Box>
    );
  }

  return (
    <>
      <Typography variant="h5" gutterBottom>
        Multiplicador de Vídeos
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
        A fórmula dos criativos vencedores: GANCHO + CORPO + CTA. Cadastre suas
        variações de cada bloco e gere todas as combinações possíveis com
        nomenclatura padronizada para teste A/B.
      </Typography>

      <Grid container spacing={3}>
        <Grid item xs={12} md={5}>
          <Card>
            <CardContent>
              <form onSubmit={handleSubmit}>
                <TextField
                  fullWidth
                  required
                  size="small"
                  label="Sigla do produto"
                  placeholder="Ex.: CINTA"
                  value={sigla}
                  inputProps={{ maxLength: 10, style: { textTransform: 'uppercase' } }}
                  onChange={(e) => setSigla(e.target.value)}
                  helperText="Usada no nome dos arquivos: [SIGLA]_G1C2A3_[DDMM].mp4"
                  sx={{ mb: 2 }}
                />

                <Typography variant="subtitle2" sx={{ mb: 1 }}>
                  Formato
                </Typography>
                <ToggleButtonGroup
                  exclusive
                  fullWidth
                  size="small"
                  value={format}
                  onChange={(_e, value) => value && setFormat(value)}
                  sx={{ mb: 2 }}
                >
                  <ToggleButton value="9:16">9:16 Vertical</ToggleButton>
                  <ToggleButton value="16:9">16:9 Horizontal</ToggleButton>
                  <ToggleButton value="1:1">1:1 Quadrado</ToggleButton>
                </ToggleButtonGroup>

                <ClipList
                  title="Ganchos"
                  emoji="🎣"
                  items={hooks}
                  max={LIMITS.hooks}
                  onChange={setHooks}
                  placeholder="Ex.: Pare de rolar o feed agora!"
                />
                <ClipList
                  title="Corpos"
                  emoji="📝"
                  items={bodies}
                  max={LIMITS.bodies}
                  onChange={setBodies}
                  placeholder="Ex.: Demonstração do produto em uso"
                />
                <ClipList
                  title="CTAs"
                  emoji="🎯"
                  items={ctas}
                  max={LIMITS.ctas}
                  onChange={setCtas}
                  placeholder="Ex.: Toque no carrinho laranja!"
                />

                <Divider sx={{ my: 2 }} />

                <Typography
                  variant="h4"
                  align="center"
                  sx={{ fontWeight: 700, mb: 2 }}
                  color={total > 0 ? 'primary' : 'text.disabled'}
                >
                  {counts.hooks} × {counts.bodies} × {counts.ctas} = {total}{' '}
                  <Typography component="span" variant="h6">
                    vídeos
                  </Typography>
                </Typography>

                {error && (
                  <Alert severity="error" sx={{ mb: 2 }}>
                    {error}
                  </Alert>
                )}

                <Button
                  fullWidth
                  type="submit"
                  variant="contained"
                  startIcon={<DynamicFeedRoundedIcon />}
                  disabled={busy || total === 0 || !sigla.trim()}
                >
                  Gerar combinações
                </Button>
              </form>
            </CardContent>
          </Card>
        </Grid>

        <Grid item xs={12} md={7}>
          <Card sx={{ mb: 3 }}>
            <CardContent>
              {result ? (
                <>
                  <Stack
                    direction="row"
                    alignItems="center"
                    justifyContent="space-between"
                    flexWrap="wrap"
                    sx={{ mb: 2, gap: 1 }}
                  >
                    <Typography variant="h6">
                      {result.sigla} — {result.combinations.length} combinações ({result.format})
                    </Typography>
                    <Stack direction="row" spacing={1}>
                      <Button
                        size="small"
                        variant="outlined"
                        startIcon={<ContentCopyRoundedIcon />}
                        onClick={() => handleCopy(result.combinations)}
                      >
                        {copied ? 'Copiado!' : 'Copiar lista'}
                      </Button>
                      <Button
                        size="small"
                        variant="outlined"
                        startIcon={<DownloadRoundedIcon />}
                        onClick={() => handleDownloadCsv(result)}
                      >
                        Baixar CSV
                      </Button>
                    </Stack>
                  </Stack>
                  {renderCombinationsTable(result.combinations)}
                </>
              ) : (
                <Box sx={{ textAlign: 'center', py: 6 }}>
                  <Typography variant="h2" sx={{ mb: 1 }}>
                    🎬
                  </Typography>
                  <Typography variant="h6" gutterBottom>
                    Suas combinações aparecerão aqui
                  </Typography>
                  <Typography variant="body2" color="text.secondary" sx={{ maxWidth: 420, mx: 'auto' }}>
                    Preencha a sigla, escolha o formato e cadastre seus clipes de
                    gancho, corpo e CTA. Dica: grave variações curtas de gancho —
                    os 3 primeiros segundos decidem o scroll.
                  </Typography>
                </Box>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardContent>
              <Typography variant="h6" gutterBottom>
                Planos salvos
              </Typography>
              {plans.length === 0 ? (
                <Typography variant="body2" color="text.secondary">
                  Nenhum plano salvo ainda. Gere sua primeira matriz de combinações!
                </Typography>
              ) : (
                <Stack divider={<Divider />} spacing={1}>
                  {plans.map((plan) => (
                    <Box key={plan.id}>
                      <Stack direction="row" alignItems="center" spacing={1}>
                        <Box sx={{ flexGrow: 1, minWidth: 0 }}>
                          <Typography variant="subtitle2">
                            {plan.sigla}{' '}
                            <Chip size="small" variant="outlined" label={plan.format} sx={{ ml: 0.5 }} />
                          </Typography>
                          <Typography variant="caption" color="text.secondary">
                            {plan.hooks.length} ganchos × {plan.bodies.length} corpos ×{' '}
                            {plan.ctas.length} CTAs = {plan.total} vídeos ·{' '}
                            {new Date(plan.createdAt).toLocaleDateString('pt-BR')}
                          </Typography>
                        </Box>
                        <IconButton
                          size="small"
                          aria-label="Ver combinações"
                          onClick={() => handleToggleExpand(plan.id)}
                        >
                          {expanded === plan.id ? (
                            <ExpandLessRoundedIcon fontSize="small" />
                          ) : (
                            <ExpandMoreRoundedIcon fontSize="small" />
                          )}
                        </IconButton>
                        <IconButton
                          size="small"
                          aria-label="Excluir plano"
                          onClick={() => handleDeletePlan(plan.id)}
                        >
                          <DeleteOutlineRoundedIcon fontSize="small" />
                        </IconButton>
                      </Stack>
                      <Collapse in={expanded === plan.id} unmountOnExit>
                        <Box sx={{ mt: 1 }}>
                          {expandedDetail && expandedDetail.id === plan.id ? (
                            <>
                              <Stack direction="row" spacing={1} sx={{ mb: 1 }}>
                                <Button
                                  size="small"
                                  startIcon={<ContentCopyRoundedIcon />}
                                  onClick={() => handleCopy(expandedDetail.combinations)}
                                >
                                  Copiar lista
                                </Button>
                                <Button
                                  size="small"
                                  startIcon={<DownloadRoundedIcon />}
                                  onClick={() => handleDownloadCsv(expandedDetail)}
                                >
                                  Baixar CSV
                                </Button>
                              </Stack>
                              {renderCombinationsTable(expandedDetail.combinations)}
                            </>
                          ) : (
                            <Typography variant="caption" color="text.secondary">
                              Carregando…
                            </Typography>
                          )}
                        </Box>
                      </Collapse>
                    </Box>
                  ))}
                </Stack>
              )}
            </CardContent>
          </Card>
        </Grid>
      </Grid>
    </>
  );
}
