import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Checkbox,
  Chip,
  CircularProgress,
  FormControlLabel,
  Grid,
  IconButton,
  LinearProgress,
  Menu,
  MenuItem,
  Slider,
  Stack,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Tooltip,
  Typography,
} from '@mui/material';
import AutoAwesomeRoundedIcon from '@mui/icons-material/AutoAwesomeRounded';
import BoltRoundedIcon from '@mui/icons-material/BoltRounded';
import ContentCopyRoundedIcon from '@mui/icons-material/ContentCopyRounded';
import ContentCutRoundedIcon from '@mui/icons-material/ContentCutRounded';
import DeleteOutlineRoundedIcon from '@mui/icons-material/DeleteOutlineRounded';
import DownloadRoundedIcon from '@mui/icons-material/DownloadRounded';
import DynamicFeedRoundedIcon from '@mui/icons-material/DynamicFeedRounded';
import CheckCircleOutlineRoundedIcon from '@mui/icons-material/CheckCircleOutlineRounded';
import MovieRoundedIcon from '@mui/icons-material/MovieRounded';
import PsychologyRoundedIcon from '@mui/icons-material/PsychologyRounded';
import SearchRoundedIcon from '@mui/icons-material/SearchRounded';
import SubtitlesRoundedIcon from '@mui/icons-material/SubtitlesRounded';
import UploadRoundedIcon from '@mui/icons-material/UploadRounded';
import { ChangeEvent, MouseEvent, useCallback, useEffect, useRef, useState } from 'react';
import { Link as RouterLink } from 'react-router-dom';
import { GlobalLoader } from '@/components/ui/GlobalLoader';
import { useConfirmacao } from '@/components/ui/ConfirmDialog';
import { useConfirmarGasto } from '@/hooks/useConfirmarGasto';
import { CREDITS_CHANGED_EVENT, resolveApiUrl } from '@/services/api';
import {
  ClipRole,
  CutClip,
  CutFormat,
  CutJobDetail,
  CutJobSummary,
  CutMode,
  CutQuote,
  cutsService,
  formatarTempo,
  lerDuracaoDoVideo,
  LIMITE_POR_BLOCO,
  LIMITES_DE_CORTE,
  NOME_DO_BLOCO,
} from '@/services/cuts.service';
import { mensagemDeErro } from '@/services/erros';

const MODOS: Array<{
  id: CutMode;
  titulo: string;
  descricao: string;
  icone: JSX.Element;
}> = [
  {
    id: 'rapido',
    titulo: 'Rápido',
    descricao:
      'Divide o vídeo em trechos espalhados do começo ao fim, cortando nas pausas da fala. Sem IA — o mais barato.',
    icone: <BoltRoundedIcon />,
  },
  {
    id: 'inteligente',
    titulo: 'Inteligente',
    descricao:
      'Transcreve o vídeo e a IA escolhe os melhores momentos, com título e gancho prontos para cada corte.',
    icone: <AutoAwesomeRoundedIcon />,
  },
];

const STATUS_LABEL: Record<CutJobSummary['status'], string> = {
  pendente: 'Na fila',
  processando: 'Cortando…',
  pronto: 'Pronto',
  falhou: 'Falhou',
};

export function CutsPage() {
  const { confirmar, dialogo } = useConfirmarGasto();
  const { confirmar: confirmarApagar, dialogoDeConfirmacao } = useConfirmacao();

  const [mode, setMode] = useState<CutMode>('rapido');
  const [format, setFormat] = useState<CutFormat>('9:16');
  const [captions, setCaptions] = useState(true);
  const [quantity, setQuantity] = useState(6);
  const [faixa, setFaixa] = useState<[number, number]>([30, 60]);
  const [file, setFile] = useState<File | null>(null);
  const [duracao, setDuracao] = useState<number | null>(null);
  const [quote, setQuote] = useState<CutQuote | null>(null);
  const [enviando, setEnviando] = useState(false);
  /*
   * Trava síncrona contra o duplo clique. O `enviando` do estado só chega ao
   * botão na próxima renderização, e entre o clique e o diálogo de gasto há
   * um `await` (consulta de carteira) — cada clique nesse intervalo abria
   * outro envio e cobrava os mesmos cortes de novo.
   */
  const enviandoRef = useRef(false);
  const [progresso, setProgresso] = useState(0);
  const [erro, setErro] = useState<string | null>(null);

  const [jobs, setJobs] = useState<CutJobSummary[]>([]);
  const [selecionado, setSelecionado] = useState<CutJobDetail | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const carregarJobs = useCallback(async () => {
    try {
      setJobs(await cutsService.list());
    } catch {
      /* lista vazia é melhor que erro numa tela que ainda vai receber o job */
    }
  }, []);

  useEffect(() => {
    void carregarJobs();
  }, [carregarJobs]);

  // Cotação: muda com o modo, a quantidade e a duração lida do arquivo.
  useEffect(() => {
    let vivo = true;
    cutsService
      .quote(mode, quantity, duracao ?? undefined)
      .then((q) => vivo && setQuote(q))
      .catch(() => vivo && setQuote(null));
    return () => {
      vivo = false;
    };
  }, [mode, quantity, duracao]);

  // Polling do job aberto enquanto ele processa; a lista acompanha.
  useEffect(() => {
    if (!selecionado || selecionado.status !== 'processando') return;
    const id = selecionado.id;
    const timer = setInterval(async () => {
      try {
        const atual = await cutsService.get(id);
        setSelecionado(atual);
        if (atual.status !== 'processando') {
          window.dispatchEvent(new Event(CREDITS_CHANGED_EVENT));
          void carregarJobs();
        }
      } catch {
        /* tenta de novo no próximo tick */
      }
    }, 4000);
    return () => clearInterval(timer);
  }, [selecionado, carregarJobs]);

  async function escolherArquivo(e: ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0] ?? null;
    e.target.value = '';
    setErro(null);
    setFile(f);
    setDuracao(f ? await lerDuracaoDoVideo(f) : null);
  }

  const duracaoFora =
    duracao !== null &&
    (duracao < LIMITES_DE_CORTE.fonteMinSeg || duracao > LIMITES_DE_CORTE.fonteMaxSeg);

  async function enviar() {
    if (!file || !quote || enviandoRef.current) return;
    enviandoRef.current = true;
    setEnviando(true);
    setErro(null);
    try {
      const autorizado = await confirmar({
        acao: mode === 'inteligente' ? 'cut_ai' : 'cut',
        titulo: `Gerar ${quantity} cortes`,
        quantidade: quantity,
        custoTotal: quote.total,
        detalhe:
          mode === 'inteligente'
            ? `${quote.cortes} cr pelos cortes + ${quote.transcricao} cr pela transcrição (${quote.blocosDeTranscricao} bloco${quote.blocosDeTranscricao > 1 ? 's' : ''} de 10 min). Cortes que não saírem são devolvidos.`
            : `${quote.porCorte} cr por corte. Cortes que não saírem são devolvidos.`,
      });
      if (!autorizado) return;

      setProgresso(0);
      const job = await cutsService.create(
        {
          mode,
          format,
          quantity,
          minSeconds: faixa[0],
          maxSeconds: faixa[1],
          captions: mode === 'inteligente' && captions,
        },
        file,
        setProgresso,
      );
      setFile(null);
      setDuracao(null);
      await carregarJobs();
      setSelecionado(await cutsService.get(job.id));
    } catch (error) {
      setErro(mensagemDeErro(error, 'Não consegui enviar o vídeo. Tente de novo.'));
    } finally {
      enviandoRef.current = false;
      setEnviando(false);
    }
  }

  async function abrir(id: string) {
    try {
      setSelecionado(await cutsService.get(id));
    } catch (error) {
      setErro(mensagemDeErro(error));
    }
  }

  async function apagar(id: string) {
    const ok = await confirmarApagar({
      titulo: 'Apagar este vídeo e os cortes?',
      mensagem: 'Os cortes gerados somem junto. Não dá para desfazer.',
      textoConfirmar: 'Apagar',
      destrutivo: true,
    });
    if (!ok) return;
    try {
      await cutsService.remove(id);
      if (selecionado?.id === id) setSelecionado(null);
      await carregarJobs();
    } catch (error) {
      setErro(mensagemDeErro(error));
    }
  }

  return (
    <Box>
      <Stack direction="row" spacing={1.75} alignItems="center" sx={{ mb: 3, flexWrap: 'wrap', rowGap: 1.5 }}>
        <Box
          sx={{
            width: 46,
            height: 46,
            flexShrink: 0,
            borderRadius: 3,
            display: 'grid',
            placeItems: 'center',
            color: '#fff',
            background: 'linear-gradient(135deg, #fe2c55 0%, #7c4dff 100%)',
            boxShadow: '0 8px 22px rgba(254,44,85,0.35)',
          }}
        >
          <ContentCutRoundedIcon />
        </Box>
        <Box sx={{ minWidth: 240, flex: 1 }}>
          <Typography variant="h5">Cortes</Typography>
          <Typography variant="body2" color="text.secondary">
            Suba um vídeo de {LIMITES_DE_CORTE.fonteMinSeg / 60} a {LIMITES_DE_CORTE.fonteMaxSeg / 60} minutos e receba vários vídeos curtos prontos para postar.
          </Typography>
        </Box>
      </Stack>

      {erro && (
        <Alert severity="error" onClose={() => setErro(null)} sx={{ mb: 2 }}>
          {erro}
        </Alert>
      )}

      <Grid container spacing={2}>
        <Grid item xs={12} md={5}>
          <Card>
            <CardContent>
              <Stack spacing={2.5}>
                <Box>
                  <Typography variant="subtitle2" sx={{ mb: 1 }}>1. Como escolher os trechos</Typography>
                  <Stack spacing={1}>
                    {MODOS.map((m) => {
                      const ativo = mode === m.id;
                      return (
                        <Box
                          key={m.id}
                          onClick={() => setMode(m.id)}
                          sx={{
                            p: 1.5,
                            border: '1px solid',
                            borderColor: ativo ? 'primary.main' : 'divider',
                            borderRadius: 2,
                            cursor: 'pointer',
                            bgcolor: ativo ? 'action.selected' : 'transparent',
                          }}
                        >
                          <Stack direction="row" spacing={1} alignItems="center">
                            {m.icone}
                            <Typography sx={{ fontWeight: 700 }}>{m.titulo}</Typography>
                            <Box sx={{ flexGrow: 1 }} />
                            {quote && quote.mode === m.id && (
                              <Chip size="small" label={`${quote.porCorte} cr/corte`} />
                            )}
                          </Stack>
                          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                            {m.descricao}
                          </Typography>
                        </Box>
                      );
                    })}
                  </Stack>
                </Box>

                <Box>
                  <Typography variant="subtitle2" sx={{ mb: 1 }}>2. O vídeo</Typography>
                  <input
                    ref={inputRef}
                    type="file"
                    accept="video/*"
                    hidden
                    onChange={(e) => void escolherArquivo(e)}
                  />
                  <Button
                    variant="outlined"
                    startIcon={<UploadRoundedIcon />}
                    onClick={() => inputRef.current?.click()}
                    disabled={enviando}
                    fullWidth
                  >
                    {file ? file.name : 'Escolher vídeo (mp4, mov, mkv, webm)'}
                  </Button>
                  {file && (
                    <Typography variant="caption" color={duracaoFora ? 'error' : 'text.secondary'}>
                      {duracao !== null
                        ? `Duração: ${formatarTempo(duracao)}${duracaoFora ? ` — precisa ter entre ${LIMITES_DE_CORTE.fonteMinSeg / 60} e ${LIMITES_DE_CORTE.fonteMaxSeg / 60} min` : ''}`
                        : 'Não consegui ler a duração aqui; o servidor confere ao processar.'}
                      {' · '}
                      {(file.size / 1024 / 1024).toFixed(0)} MB
                    </Typography>
                  )}
                </Box>

                <Box>
                  <Typography variant="subtitle2" sx={{ mb: 1 }}>3. Os cortes</Typography>
                  <Stack spacing={2}>
                    <TextField
                      label="Quantos cortes"
                      type="number"
                      size="small"
                      value={quantity}
                      onChange={(e) =>
                        setQuantity(
                          Math.max(
                            LIMITES_DE_CORTE.qtdMin,
                            Math.min(LIMITES_DE_CORTE.qtdMax, Number(e.target.value) || 0),
                          ),
                        )
                      }
                      inputProps={{ min: LIMITES_DE_CORTE.qtdMin, max: LIMITES_DE_CORTE.qtdMax }}
                      helperText={`De ${LIMITES_DE_CORTE.qtdMin} a ${LIMITES_DE_CORTE.qtdMax}`}
                    />
                    <Box sx={{ px: 1 }}>
                      <Typography variant="body2" color="text.secondary">
                        Duração de cada corte: {faixa[0]}s a {faixa[1]}s
                      </Typography>
                      <Slider
                        value={faixa}
                        min={LIMITES_DE_CORTE.corteMinSeg}
                        max={LIMITES_DE_CORTE.corteMaxSeg}
                        step={5}
                        disableSwap
                        valueLabelDisplay="auto"
                        onChange={(_, v) => setFaixa(v as [number, number])}
                      />
                    </Box>
                    <ToggleButtonGroup
                      exclusive
                      size="small"
                      value={format}
                      onChange={(_, v: CutFormat | null) => v && setFormat(v)}
                    >
                      <ToggleButton value="9:16">9:16 vertical</ToggleButton>
                      <ToggleButton value="1:1">1:1</ToggleButton>
                      <ToggleButton value="16:9">16:9</ToggleButton>
                    </ToggleButtonGroup>
                    {mode === 'inteligente' && (
                      <FormControlLabel
                        control={
                          <Checkbox checked={captions} onChange={(e) => setCaptions(e.target.checked)} />
                        }
                        label={
                          <Box>
                            <Typography variant="body2">Legenda queimada no vídeo</Typography>
                            <Typography variant="caption" color="text.secondary">
                              A fala vira legenda no terço de baixo. Sem custo extra; usa a transcrição.
                            </Typography>
                          </Box>
                        }
                      />
                    )}
                  </Stack>
                </Box>

                {quote && (
                  <Alert severity="info" icon={false}>
                    <strong>{quote.total} créditos</strong>
                    {' — '}
                    {quote.cortes} pelos {quantity} cortes
                    {quote.transcricao > 0 && ` + ${quote.transcricao} pela transcrição`}
                    {mode === 'inteligente' && duracao === null && ' (transcrição estimada para 10 min)'}
                    . Corte que não sair é devolvido.
                  </Alert>
                )}

                {enviando && (
                  <Box>
                    <LinearProgress variant="determinate" value={progresso} />
                    <Typography variant="caption" color="text.secondary">
                      {progresso < 100 ? `Enviando… ${progresso}%` : 'Enviado. Iniciando o processamento…'}
                    </Typography>
                  </Box>
                )}

                <Button
                  variant="contained"
                  size="large"
                  startIcon={
                    enviando ? <CircularProgress size={18} color="inherit" /> : <ContentCutRoundedIcon />
                  }
                  disabled={!file || duracaoFora || enviando || !quote}
                  onClick={() => void enviar()}
                >
                  {enviando
                    ? 'Enviando…'
                    : `Gerar ${quantity} cortes${quote ? ` · ${quote.total} créditos` : ''}`}
                </Button>
              </Stack>
            </CardContent>
          </Card>
        </Grid>

        <Grid item xs={12} md={7}>
          <Stack spacing={2}>
            <Card>
              <CardContent>
                <Typography variant="subtitle2" sx={{ mb: 1 }}>Seus vídeos</Typography>
                {jobs.length === 0 ? (
                  <Typography variant="body2" color="text.secondary">
                    Nenhum vídeo cortado ainda. O primeiro aparece aqui assim que você enviar.
                  </Typography>
                ) : (
                  <Stack spacing={1}>
                    {jobs.map((j) => (
                      <Stack
                        key={j.id}
                        direction="row"
                        alignItems="center"
                        spacing={1}
                        onClick={() => void abrir(j.id)}
                        sx={{
                          p: 1.25,
                          border: '1px solid',
                          borderColor: selecionado?.id === j.id ? 'primary.main' : 'divider',
                          borderRadius: 2,
                          cursor: 'pointer',
                          flexWrap: 'wrap',
                          rowGap: 0.5,
                          '&:hover': { bgcolor: 'action.hover' },
                        }}
                      >
                        {j.status === 'processando' && <CircularProgress size={16} />}
                        <Typography sx={{ fontWeight: 600, wordBreak: 'break-word', flex: 1, minWidth: 160 }}>
                          {j.sourceName}
                        </Typography>
                        <Chip size="small" variant="outlined" label={j.mode === 'inteligente' ? 'Inteligente' : 'Rápido'} />
                        <Chip size="small" variant="outlined" label={j.format} />
                        <Chip
                          size="small"
                          color={j.status === 'pronto' ? 'success' : j.status === 'falhou' ? 'error' : 'default'}
                          label={
                            j.status === 'processando' && j.clipsTotal
                              ? `${j.clipsProntos}/${j.clipsTotal} prontos`
                              : STATUS_LABEL[j.status]
                          }
                        />
                        {j.status !== 'processando' && (
                          <Tooltip title="Apagar este vídeo e os cortes">
                            <IconButton
                              size="small"
                              onClick={(e) => {
                                e.stopPropagation();
                                void apagar(j.id);
                              }}
                            >
                              <DeleteOutlineRoundedIcon fontSize="small" />
                            </IconButton>
                          </Tooltip>
                        )}
                      </Stack>
                    ))}
                  </Stack>
                )}
              </CardContent>
            </Card>

            {selecionado && <DetalheDoJob job={selecionado} />}
          </Stack>
        </Grid>
      </Grid>
      {dialogo}
      {dialogoDeConfirmacao}
    </Box>
  );
}

function DetalheDoJob({ job }: { job: CutJobDetail }) {
  const prontos = job.clips.filter((c) => c.status === 'pronto').length;
  return (
    <Card>
      <CardContent>
        <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 1.5, flexWrap: 'wrap', rowGap: 0.5 }}>
          <Typography variant="subtitle2" sx={{ flex: 1, minWidth: 160 }}>
            {job.sourceName}
            {job.sourceDurationSeconds ? ` · ${formatarTempo(job.sourceDurationSeconds)}` : ''}
          </Typography>
          <Typography variant="caption" color="text.secondary">
            {job.status === 'processando'
              ? `Cortando… ${prontos}/${job.clips.length || job.quantity}`
              : `${prontos} ${prontos === 1 ? 'corte pronto' : 'cortes prontos'}`}
          </Typography>
        </Stack>

        {job.status === 'falhou' && (
          <Alert severity="error" sx={{ mb: 2 }}>
            {job.error ?? 'O processamento falhou.'}
          </Alert>
        )}
        {job.status === 'processando' && <LoaderDoJob job={job} />}

        <Grid container spacing={2}>
          {job.clips.map((c) => (
            <Grid item xs={12} sm={6} key={c.id}>
              <CardDoCorte clip={c} job={job} />
            </Grid>
          ))}
        </Grid>
      </CardContent>
    </Card>
  );
}

// O backend só expõe pendente/processando/pronto/falhou no job + status por
// clip; as etapas são derivadas daí. O % é interpolado dentro da etapa.
const ETAPAS_DE_CORTE = [
  { label: 'Carregando seu vídeo', icone: <UploadRoundedIcon /> },
  { label: 'Entendendo o vídeo', icone: <PsychologyRoundedIcon /> },
  { label: 'Buscando os melhores momentos', icone: <SearchRoundedIcon /> },
  { label: 'Montando os cortes', icone: <MovieRoundedIcon /> },
  { label: 'Quase pronto', icone: <CheckCircleOutlineRoundedIcon /> },
];

function etapaDoJob(job: CutJobDetail): { etapa: number; progresso?: number } {
  if (job.status === 'pendente') return { etapa: 0 };
  const total = job.clips.length || job.quantity || 1;
  if (job.clips.length === 0) return { etapa: job.mode === 'inteligente' ? 1 : 2 };
  const feitos = job.clips.filter((c) => c.status !== 'pendente').length;
  if (feitos > 0 && feitos >= total - 1) return { etapa: 4, progresso: 80 + (feitos / total) * 17 };
  // "Montando" ocupa 60–80% e anda junto com os cortes concluídos.
  return { etapa: 3, progresso: 60 + (feitos / total) * 20 };
}

function LoaderDoJob({ job }: { job: CutJobDetail }) {
  const { etapa, progresso } = etapaDoJob(job);
  return (
    <Box sx={{ mb: 2 }}>
      <GlobalLoader
        titulo="Estamos preparando seus cortes…"
        etapas={ETAPAS_DE_CORTE}
        etapaAtual={etapa}
        progresso={progresso}
        tempoEstimado={job.mode === 'inteligente' ? '10 min' : '4 min'}
        dica="veja o que está viralizando agora e separe ideias para os próximos vídeos."
        linkExplorar="/tendencias"
      />
    </Box>
  );
}

function CardDoCorte({ clip, job }: { clip: CutClip; job: CutJobDetail }) {
  const [copiado, setCopiado] = useState(false);
  const [menu, setMenu] = useState<HTMLElement | null>(null);
  const [enviando, setEnviando] = useState<ClipRole | null>(null);
  const [aviso, setAviso] = useState<{ tipo: 'success' | 'error'; texto: string } | null>(null);
  const nome = `${job.sourceName.replace(/\.[^.]+$/, '')}-corte-${clip.position}.mp4`;
  const legenda = [clip.title, clip.hook].filter(Boolean).join('\n');
  const duracao = clip.endSeconds - clip.startSeconds;
  // Só os blocos em que o corte cabe (teto duro do Multiplicador).
  const blocos = (Object.keys(LIMITE_POR_BLOCO) as ClipRole[]).map((role) => ({
    role,
    cabe: duracao <= LIMITE_POR_BLOCO[role],
  }));

  async function mandarParaMultiplicador(role: ClipRole) {
    setMenu(null);
    setEnviando(role);
    setAviso(null);
    try {
      await cutsService.toMultiplier(clip.id, role);
      setAviso({ tipo: 'success', texto: `Enviado como ${NOME_DO_BLOCO[role].toLowerCase()}.` });
    } catch (error) {
      setAviso({ tipo: 'error', texto: mensagemDeErro(error) });
    } finally {
      setEnviando(null);
    }
  }

  async function copiar() {
    try {
      await navigator.clipboard.writeText(legenda);
      setCopiado(true);
      setTimeout(() => setCopiado(false), 1500);
    } catch {
      /* sem clipboard (http): o texto está na tela para selecionar */
    }
  }

  return (
    <Box sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 2, overflow: 'hidden' }}>
      {clip.status === 'pronto' && clip.url ? (
        <Box
          component="video"
          src={resolveApiUrl(clip.url)}
          controls
          preload="metadata"
          sx={{
            width: '100%',
            aspectRatio: job.format === '16:9' ? '16 / 9' : job.format === '1:1' ? '1 / 1' : '9 / 16',
            maxHeight: 360,
            display: 'block',
            objectFit: 'contain',
            bgcolor: '#000',
          }}
        />
      ) : (
        <Box
          sx={{
            height: 120,
            display: 'grid',
            placeItems: 'center',
            bgcolor: 'action.hover',
            color: 'text.secondary',
          }}
        >
          {clip.status === 'falhou' ? (
            <Typography variant="caption" color="error" sx={{ px: 2, textAlign: 'center' }}>
              {clip.error ?? 'Este corte falhou (crédito devolvido).'}
            </Typography>
          ) : (
            <CircularProgress size={20} />
          )}
        </Box>
      )}
      <Box sx={{ p: 1.25 }}>
        <Stack direction="row" alignItems="center" spacing={0.5} sx={{ mb: 0.5 }}>
          <Chip size="small" label={`#${clip.position}`} />
          <Typography variant="caption" color="text.secondary">
            {formatarTempo(clip.startSeconds)} – {formatarTempo(clip.endSeconds)} ·{' '}
            {Math.round(clip.endSeconds - clip.startSeconds)}s
          </Typography>
          {clip.origin === 'ia' && (
            <Tooltip title={clip.reason ?? 'Escolhido pela IA'}>
              <Chip size="small" variant="outlined" icon={<AutoAwesomeRoundedIcon />} label="IA" />
            </Tooltip>
          )}
          {clip.captions && (
            <Tooltip title="Legenda queimada no vídeo">
              <SubtitlesRoundedIcon fontSize="small" color="action" />
            </Tooltip>
          )}
          <Box sx={{ flexGrow: 1 }} />
          {clip.status === 'pronto' && clip.url && (
            <>
              <Tooltip title="Usar no Multiplicador">
                <span>
                  <IconButton
                    size="small"
                    disabled={enviando !== null}
                    onClick={(e: MouseEvent<HTMLElement>) => setMenu(e.currentTarget)}
                  >
                    {enviando ? <CircularProgress size={16} /> : <DynamicFeedRoundedIcon fontSize="small" />}
                  </IconButton>
                </span>
              </Tooltip>
              <Menu anchorEl={menu} open={Boolean(menu)} onClose={() => setMenu(null)}>
                {blocos.map(({ role, cabe }) => (
                  <MenuItem
                    key={role}
                    disabled={!cabe}
                    onClick={() => void mandarParaMultiplicador(role)}
                  >
                    {NOME_DO_BLOCO[role]}
                    <Typography variant="caption" color="text.secondary" sx={{ ml: 1 }}>
                      {cabe ? `até ${LIMITE_POR_BLOCO[role]}s` : `passa de ${LIMITE_POR_BLOCO[role]}s`}
                    </Typography>
                  </MenuItem>
                ))}
              </Menu>
              <Tooltip title="Baixar">
                <IconButton
                  size="small"
                  component="a"
                  href={resolveApiUrl(clip.url)}
                  download={nome}
                >
                  <DownloadRoundedIcon fontSize="small" />
                </IconButton>
              </Tooltip>
            </>
          )}
        </Stack>
        {aviso && (
          <Alert
            severity={aviso.tipo}
            onClose={() => setAviso(null)}
            sx={{ mb: 0.5, py: 0 }}
            action={
              aviso.tipo === 'success' ? (
                <Button size="small" component={RouterLink} to="/multiplicador">
                  Abrir
                </Button>
              ) : undefined
            }
          >
            {aviso.texto}
          </Alert>
        )}
        {clip.title && (
          <Typography sx={{ fontWeight: 700, lineHeight: 1.25 }}>{clip.title}</Typography>
        )}
        {clip.hook && (
          <Typography variant="body2" color="text.secondary">
            {clip.hook}
          </Typography>
        )}
        {legenda && (
          <Button
            size="small"
            startIcon={<ContentCopyRoundedIcon />}
            onClick={() => void copiar()}
            sx={{ mt: 0.5 }}
          >
            {copiado ? 'Copiado!' : 'Copiar título e gancho'}
          </Button>
        )}
      </Box>
    </Box>
  );
}
