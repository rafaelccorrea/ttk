import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  Collapse,
  Divider,
  FormControlLabel,
  Grid,
  IconButton,
  LinearProgress,
  Stack,
  Switch,
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
import CloseRoundedIcon from '@mui/icons-material/CloseRounded';
import MovieFilterRoundedIcon from '@mui/icons-material/MovieFilterRounded';
import UploadRoundedIcon from '@mui/icons-material/UploadRounded';
import ContentCopyRoundedIcon from '@mui/icons-material/ContentCopyRounded';
import DeleteOutlineRoundedIcon from '@mui/icons-material/DeleteOutlineRounded';
import DownloadRoundedIcon from '@mui/icons-material/DownloadRounded';
import DynamicFeedRoundedIcon from '@mui/icons-material/DynamicFeedRounded';
import ExpandLessRoundedIcon from '@mui/icons-material/ExpandLessRounded';
import ExpandMoreRoundedIcon from '@mui/icons-material/ExpandMoreRounded';
import { DragEvent, FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import { resolveApiUrl } from '@/services/api';
import {
  ClipRole,
  Combination,
  CombinationClip,
  CombinationPlanDetail,
  CombinationPlanSummary,
  CombinationVideo,
  CombinationVideoStatus,
  PlanFormat,
  combinationsService,
} from '@/services/combinations.service';

const LIMITS = { hooks: 10, bodies: 5, ctas: 3 } as const;

/** Teto do backend (`MaxFileSizeValidator`), replicado para recusar antes de subir. */
const MAX_BYTES = 40 * 1024 * 1024;

/** Teto de montagem do backend (`MAX_VIDEOS_POR_MONTAGEM`). */
const MAX_VIDEOS = 60;

function truncate(text: string, max = 30) {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function formatarMb(bytes: number): string {
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/**
 * Checa o arquivo ANTES de subir.
 *
 * Sem isto, um clipe de 200MB gasta o upload inteiro para tomar um 413, e num
 * bloco de 10 ganchos isso é o tipo de espera que faz o vendedor achar que a
 * ferramenta travou.
 */
function validarClipe(file: File): string | null {
  if (!file.type.startsWith('video/')) return `"${file.name}" não é um vídeo.`;
  if (file.size > MAX_BYTES) {
    return `"${file.name}" tem ${formatarMb(file.size)}. O limite é 40 MB.`;
  }
  return null;
}

interface ClipDropzoneProps {
  title: string;
  emoji: string;
  clips: CombinationClip[];
  max: number;
  busy: boolean;
  disabled?: boolean;
  onUpload: (files: FileList | null) => void;
  onRemove: (id: string) => void;
}

/**
 * Um bloco da fórmula (gancho, corpo ou CTA) com os vídeos de verdade.
 *
 * Antes isto era uma lista de campos de texto: o vendedor digitava o NOME do
 * clipe e a plataforma devolvia uma planilha de nomes de arquivo, deixando a
 * montagem de cada um dos 60 vídeos para ele fazer no celular. O trabalho que
 * o produto promete economizar era exatamente o que sobrava para ele.
 *
 * O rótulo agora sai do nome do arquivo enviado — digitar o nome à parte era
 * uma segunda fonte de verdade que só podia divergir da primeira.
 */
function ClipDropzone({
  title,
  emoji,
  clips,
  max,
  busy,
  disabled,
  onUpload,
  onRemove,
}: ClipDropzoneProps) {
  const [arrastando, setArrastando] = useState(false);
  const cheio = clips.length >= max;

  return (
    <Box sx={{ mb: 2, opacity: disabled ? 0.5 : 1 }}>
      <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 1 }}>
        <Typography variant="subtitle2">
          {emoji} {title}
        </Typography>
        <Chip
          size="small"
          variant="outlined"
          color={cheio ? 'warning' : 'default'}
          label={`${clips.length}/${max}`}
        />
      </Stack>

      <Stack spacing={0.5} sx={{ mb: 1 }}>
        {clips.map((clip, index) => (
          <Stack
            key={clip.id}
            direction="row"
            spacing={1}
            alignItems="center"
            sx={{
              px: 1,
              py: 0.5,
              borderRadius: 1,
              bgcolor: 'action.hover',
            }}
          >
            {/* A posição é o que vira o código do arquivo (G1, G2...), então
                mostrá-la aqui é o que liga esta lista à matriz de resultados. */}
            <Chip
              size="small"
              label={`${title[0]}${index + 1}`}
              sx={{ fontWeight: 700, minWidth: 40 }}
            />
            <Tooltip title={clip.label}>
              <Typography variant="caption" noWrap sx={{ flexGrow: 1, minWidth: 0 }}>
                {clip.label}
              </Typography>
            </Tooltip>
            <Typography variant="caption" color="text.secondary">
              {formatarMb(clip.sizeBytes)}
            </Typography>
            <IconButton
              size="small"
              aria-label={`Remover ${clip.label}`}
              onClick={() => onRemove(clip.id)}
            >
              <CloseRoundedIcon fontSize="small" />
            </IconButton>
          </Stack>
        ))}
      </Stack>

      {!cheio && !disabled && (
        <Box
          component="label"
          onDragOver={(e: DragEvent) => {
            e.preventDefault();
            setArrastando(true);
          }}
          onDragLeave={() => setArrastando(false)}
          onDrop={(e: DragEvent) => {
            e.preventDefault();
            setArrastando(false);
            onUpload(e.dataTransfer?.files ?? null);
          }}
          sx={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 0.5,
            py: 2,
            px: 1,
            cursor: busy ? 'progress' : 'pointer',
            border: '1px dashed',
            borderColor: arrastando ? 'primary.main' : 'divider',
            bgcolor: arrastando ? 'action.selected' : 'transparent',
            borderRadius: 1.5,
            textAlign: 'center',
            transition: 'border-color .15s, background-color .15s',
          }}
        >
          {busy ? (
            <CircularProgress size={20} />
          ) : (
            <UploadRoundedIcon fontSize="small" color="action" />
          )}
          <Typography variant="caption" color="text.secondary">
            {busy ? 'Enviando...' : 'Arraste vídeos ou clique para selecionar'}
          </Typography>
          <Typography variant="caption" color="text.disabled">
            Até {max} vídeos · MP4 até 40 MB cada
          </Typography>
          <input
            type="file"
            accept="video/*"
            multiple
            hidden
            disabled={busy}
            onChange={(e) => {
              onUpload(e.target.files);
              e.target.value = '';
            }}
          />
        </Box>
      )}
    </Box>
  );
}

const ROTULO_STATUS: Record<CombinationVideoStatus, string> = {
  pendente: 'na fila',
  montando: 'montando',
  pronto: 'pronto',
  falhou: 'falhou',
};

/**
 * Acompanhamento da montagem, vídeo a vídeo.
 *
 * A montagem é sequencial e leva minutos numa matriz grande. Mostrar só um
 * spinner geral esconderia o que interessa: os primeiros vídeos já ficam
 * prontos para baixar enquanto os últimos ainda estão na fila.
 */
function RenderProgress({ videos }: { videos: CombinationVideo[] }) {
  const prontos = videos.filter((v) => v.status === 'pronto').length;
  const falhas = videos.filter((v) => v.status === 'falhou').length;

  return (
    <Box>
      <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 1 }}>
        <Box sx={{ flexGrow: 1 }}>
          <LinearProgress
            variant="determinate"
            value={((prontos + falhas) / videos.length) * 100}
            sx={{ height: 6, borderRadius: 3 }}
          />
        </Box>
        <Typography variant="caption" color="text.secondary">
          {prontos + falhas}/{videos.length}
        </Typography>
      </Stack>

      {falhas > 0 && (
        <Alert severity="warning" sx={{ mb: 1 }}>
          {falhas} vídeo(s) falharam na montagem. Os demais continuam
          disponíveis para baixar.
        </Alert>
      )}

      <Box sx={{ overflowX: 'auto' }}>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Código</TableCell>
              <TableCell>Arquivo</TableCell>
              <TableCell>Status</TableCell>
              <TableCell align="right">Vídeo</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {videos.map((v) => (
              <TableRow key={v.id} hover>
                <TableCell>
                  <Chip size="small" color="primary" variant="outlined" label={v.code} />
                </TableCell>
                <TableCell sx={{ fontFamily: 'monospace', fontSize: 12 }}>
                  {v.filename}
                </TableCell>
                <TableCell>
                  <Tooltip title={v.error ?? ''}>
                    <Chip
                      size="small"
                      label={ROTULO_STATUS[v.status]}
                      color={
                        v.status === 'pronto'
                          ? 'success'
                          : v.status === 'falhou'
                            ? 'error'
                            : 'default'
                      }
                      variant={v.status === 'montando' ? 'filled' : 'outlined'}
                    />
                  </Tooltip>
                </TableCell>
                <TableCell align="right">
                  {v.url && (
                    <Button
                      size="small"
                      component="a"
                      href={resolveApiUrl(v.url)}
                      download={v.filename}
                      target="_blank"
                      rel="noopener"
                      startIcon={<DownloadRoundedIcon />}
                    >
                      Baixar
                    </Button>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Box>
    </Box>
  );
}

export function MultiplierPage() {
  const [sigla, setSigla] = useState('');
  const [format, setFormat] = useState<PlanFormat>('9:16');

  /** Clipes já no bucket, agrupados por bloco na ordem de envio. */
  const [clips, setClips] = useState<CombinationClip[]>([]);
  const [enviando, setEnviando] = useState<ClipRole | null>(null);

  // Corpo e CTA são opcionais: às vezes o teste é só de gancho, com o mesmo
  // corpo. O backend já trata bloco vazio (não entra no código do arquivo).
  const [usarCorpo, setUsarCorpo] = useState(true);
  const [usarCta, setUsarCta] = useState(true);

  const [videos, setVideos] = useState<CombinationVideo[]>([]);
  const [montando, setMontando] = useState(false);
  // A sondagem precisa morrer quando a tela sai, senão continua batendo na API
  // para sempre e tenta atualizar o estado de um componente desmontado.
  const sondagem = useRef<number | null>(null);
  useEffect(
    () => () => {
      if (sondagem.current) clearInterval(sondagem.current);
    },
    [],
  );

  const [result, setResult] = useState<CombinationPlanDetail | null>(null);
  const [plans, setPlans] = useState<CombinationPlanSummary[]>([]);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [expandedDetail, setExpandedDetail] = useState<CombinationPlanDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    combinationsService.list().then(setPlans).catch(console.error);
    combinationsService.listClips().then(setClips).catch(console.error);
  }, []);

  const porBloco = useMemo(
    () => ({
      hook: clips.filter((c) => c.role === 'hook'),
      body: usarCorpo ? clips.filter((c) => c.role === 'body') : [],
      cta: usarCta ? clips.filter((c) => c.role === 'cta') : [],
    }),
    [clips, usarCorpo, usarCta],
  );

  const counts = {
    hooks: porBloco.hook.length,
    bodies: porBloco.body.length,
    ctas: porBloco.cta.length,
  };

  // Bloco vazio conta como 1 na matriz: desligar o CTA não zera o total, só
  // remove a letra A do código. É o mesmo cálculo do `expand()` no servidor.
  const total =
    counts.hooks * Math.max(counts.bodies, 1) * Math.max(counts.ctas, 1);
  const acimaDoTeto = total > MAX_VIDEOS;

  async function handleUpload(role: ClipRole, files: FileList | null) {
    const lista = Array.from(files ?? []);
    if (!lista.length) return;
    setError(null);

    const cabem = LIMITS[role === 'hook' ? 'hooks' : role === 'body' ? 'bodies' : 'ctas'] -
      clips.filter((c) => c.role === role).length;
    if (lista.length > cabem) {
      setError(`Cabem mais ${cabem} vídeo(s) neste bloco.`);
      return;
    }
    for (const arquivo of lista) {
      const problema = validarClipe(arquivo);
      if (problema) {
        setError(problema);
        return;
      }
    }

    setEnviando(role);
    try {
      // Um por vez: são arquivos grandes, e em paralelo o navegador estrangula
      // a banda e o servidor recebe vários multipart de 40MB de uma só vez.
      for (const arquivo of lista) {
        const clip = await combinationsService.uploadClip(role, arquivo);
        setClips((prev) => [...prev, clip]);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao enviar o vídeo');
    } finally {
      setEnviando(null);
    }
  }

  async function handleRemoveClip(id: string) {
    // Otimista: a lista some na hora e volta se o servidor recusar.
    const anterior = clips;
    setClips((prev) => prev.filter((c) => c.id !== id));
    try {
      await combinationsService.deleteClip(id);
    } catch (err) {
      setClips(anterior);
      setError(err instanceof Error ? err.message : 'Falha ao remover o vídeo');
    }
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const plan = await combinationsService.create({
        sigla: sigla.trim().toUpperCase(),
        format,
        // Rótulo e clipe saem da MESMA lista, na mesma ordem: é isso que faz
        // o vídeo G3 sair com o nome do gancho 3.
        hooks: porBloco.hook.map((c) => c.label),
        bodies: porBloco.body.map((c) => c.label),
        ctas: porBloco.cta.map((c) => c.label),
        hookClipIds: porBloco.hook.map((c) => c.id),
        bodyClipIds: porBloco.body.map((c) => c.id),
        ctaClipIds: porBloco.cta.map((c) => c.id),
      });
      setResult(plan);
      setVideos([]);
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

  /**
   * Dispara a montagem e acompanha até acabar.
   *
   * O servidor devolve na hora a lista `pendente` e concatena em segundo plano
   * (são segundos de ffmpeg por vídeo, dezenas de vídeos), então a tela precisa
   * perguntar de tempos em tempos. O intervalo é de 3s: mais curto martela o
   * banco à toa, mais longo faz parecer travado.
   */
  async function handleRender(planId: string) {
    setError(null);
    setMontando(true);
    try {
      setVideos(await combinationsService.render(planId));
      if (sondagem.current) clearInterval(sondagem.current);
      sondagem.current = window.setInterval(async () => {
        try {
          const atual = await combinationsService.listVideos(planId);
          setVideos(atual);
          const acabou = atual.every(
            (v) => v.status === 'pronto' || v.status === 'falhou',
          );
          if (acabou) {
            if (sondagem.current) clearInterval(sondagem.current);
            setMontando(false);
          }
        } catch {
          // Falha de rede numa sondagem não é motivo para abortar a montagem,
          // que segue rodando no servidor. A próxima tentativa reconcilia.
        }
      }, 3000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao montar os vídeos');
      setMontando(false);
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
        A fórmula dos criativos vencedores: GANCHO + CORPO + CTA. Suba seus
        clipes de cada bloco e a gente combina tudo em vídeos prontos para
        postar, com nomenclatura padronizada para teste A/B.
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

                {/* Gancho é obrigatório — é o bloco que decide o scroll e o
                    que dá a primeira letra do código. Corpo e CTA saem e
                    entram conforme o teste. */}
                <Stack
                  direction="row"
                  alignItems="center"
                  flexWrap="wrap"
                  sx={{ mb: 2, gap: 1 }}
                >
                  <Typography variant="subtitle2">Combinar:</Typography>
                  <Chip size="small" label="🎣 Gancho (sempre)" />
                  <FormControlLabel
                    control={
                      <Switch
                        size="small"
                        checked={usarCorpo}
                        onChange={(e) => setUsarCorpo(e.target.checked)}
                      />
                    }
                    label={<Typography variant="body2">📝 Corpo</Typography>}
                  />
                  <FormControlLabel
                    control={
                      <Switch
                        size="small"
                        checked={usarCta}
                        onChange={(e) => setUsarCta(e.target.checked)}
                      />
                    }
                    label={<Typography variant="body2">🎯 CTA</Typography>}
                  />
                </Stack>

                <ClipDropzone
                  title="Ganchos"
                  emoji="🎣"
                  clips={clips.filter((c) => c.role === 'hook')}
                  max={LIMITS.hooks}
                  busy={enviando === 'hook'}
                  onUpload={(files) => void handleUpload('hook', files)}
                  onRemove={(id) => void handleRemoveClip(id)}
                />
                <ClipDropzone
                  title="Corpos"
                  emoji="📝"
                  clips={clips.filter((c) => c.role === 'body')}
                  max={LIMITS.bodies}
                  busy={enviando === 'body'}
                  disabled={!usarCorpo}
                  onUpload={(files) => void handleUpload('body', files)}
                  onRemove={(id) => void handleRemoveClip(id)}
                />
                <ClipDropzone
                  title="CTAs"
                  emoji="🎯"
                  clips={clips.filter((c) => c.role === 'cta')}
                  max={LIMITS.ctas}
                  busy={enviando === 'cta'}
                  disabled={!usarCta}
                  onUpload={(files) => void handleUpload('cta', files)}
                  onRemove={(id) => void handleRemoveClip(id)}
                />

                <Divider sx={{ my: 2 }} />

                <Typography
                  variant="h4"
                  align="center"
                  sx={{ fontWeight: 700, mb: 2 }}
                  color={total > 0 ? 'primary' : 'text.disabled'}
                >
                  {counts.hooks} × {Math.max(counts.bodies, 1)} ×{' '}
                  {Math.max(counts.ctas, 1)} = {total}{' '}
                  <Typography component="span" variant="h6">
                    vídeos
                  </Typography>
                </Typography>

                {acimaDoTeto && (
                  <Alert severity="warning" sx={{ mb: 2 }}>
                    São {total} vídeos, acima do limite de {MAX_VIDEOS} por
                    montagem. Remova clipes de um dos blocos.
                  </Alert>
                )}

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
                  disabled={busy || total === 0 || acimaDoTeto || !sigla.trim()}
                >
                  Gerar combinações
                </Button>
                {counts.hooks === 0 && (
                  <Typography
                    variant="caption"
                    color="text.secondary"
                    display="block"
                    align="center"
                    sx={{ mt: 1 }}
                  >
                    Envie ao menos um vídeo de gancho para começar.
                  </Typography>
                )}
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
                      <Button
                        size="small"
                        variant="contained"
                        startIcon={
                          montando ? (
                            <CircularProgress size={14} color="inherit" />
                          ) : (
                            <MovieFilterRoundedIcon />
                          )
                        }
                        disabled={montando}
                        onClick={() => void handleRender(result.id)}
                      >
                        {montando ? 'Montando...' : 'Montar vídeos'}
                      </Button>
                    </Stack>
                  </Stack>

                  {videos.length > 0 ? (
                    <RenderProgress videos={videos} />
                  ) : (
                    renderCombinationsTable(result.combinations)
                  )}
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
