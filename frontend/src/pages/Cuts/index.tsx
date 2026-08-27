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
import StopCircleRoundedIcon from '@mui/icons-material/StopCircleRounded';
import DownloadRoundedIcon from '@mui/icons-material/DownloadRounded';
import DynamicFeedRoundedIcon from '@mui/icons-material/DynamicFeedRounded';
import CheckCircleOutlineRoundedIcon from '@mui/icons-material/CheckCircleOutlineRounded';
import MovieRoundedIcon from '@mui/icons-material/MovieRounded';
import PsychologyRoundedIcon from '@mui/icons-material/PsychologyRounded';
import SearchRoundedIcon from '@mui/icons-material/SearchRounded';
import SubtitlesRoundedIcon from '@mui/icons-material/SubtitlesRounded';
import UploadRoundedIcon from '@mui/icons-material/UploadRounded';
import LinkRoundedIcon from '@mui/icons-material/LinkRounded';
import EmojiEventsRoundedIcon from '@mui/icons-material/EmojiEventsRounded';
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
  CutCapabilities,
  CaptionStyle,
  InfoDoLink,
  ReframeMode,
  cutsService,
  formatarTempo,
  lerDuracaoDoVideo,
  capturarQuadroDoVideo,
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
      'Transcreve o vídeo e a IA escolhe só os momentos que se sustentam sozinhos, com título e gancho. Se o vídeo não render a quantidade pedida, saem menos e o resto é devolvido.',
    icone: <AutoAwesomeRoundedIcon />,
  },
];

/**
 * Perfis de legenda — espelho de `CAPTION_STYLES` no backend. O `preview` é
 * só CSS imitando o que o libass desenha; a legenda de verdade é queimada no
 * servidor, então o objetivo aqui é dar para escolher sem gerar.
 */
const ESTILOS_DE_LEGENDA: Array<{
  id: CaptionStyle;
  nome: string;
  dica: string;
  exemplo: string;
  preview: Record<string, string | number>;
}> = [
  {
    id: 'classico',
    nome: 'Clássico',
    dica: 'Branco com contorno preto. Funciona em qualquer fundo.',
    exemplo: 'Olha só esse preço',
    preview: { color: '#fff', fontWeight: 800, WebkitTextStroke: '0.6px #000', textShadow: '0 0 3px #000' },
  },
  {
    id: 'karaoke',
    nome: 'Karaokê',
    dica: 'Cada palavra acende na hora em que é falada.',
    exemplo: 'Olha só esse preço',
    preview: { color: '#fff', fontWeight: 800, WebkitTextStroke: '0.6px #000', textShadow: '0 0 3px #000' },
  },
  {
    id: 'impacto',
    nome: 'Impacto',
    dica: 'Caixa alta, amarelo, contorno grosso. Para gancho e reação.',
    exemplo: 'OLHA SÓ ESSE PREÇO',
    preview: { color: '#FFD500', fontWeight: 900, WebkitTextStroke: '0.8px #000', textShadow: '0 0 4px #000', letterSpacing: 0.5 },
  },
  {
    id: 'minimal',
    nome: 'Minimal',
    dica: 'Letra menor numa tarja escura. Discreto, para conteúdo falado.',
    exemplo: 'Olha só esse preço',
    preview: { color: '#fff', fontWeight: 500, fontSize: 11, bgcolor: 'rgba(0,0,0,.6)', px: 0.75, py: 0.25, borderRadius: 0.5 },
  },
  {
    id: 'oferta',
    nome: 'Oferta',
    dica: 'Caixa alta com o preço em destaque. Feito para vídeo de venda.',
    exemplo: 'SÓ HOJE POR R$ 49,90',
    preview: { color: '#fff', fontWeight: 900, WebkitTextStroke: '0.7px #000', textShadow: '0 0 4px #000' },
  },
];

const PROPORCAO: Record<CutFormat, string> = { '9:16': '9 / 16', '1:1': '1 / 1', '16:9': '16 / 9' };

/**
 * Preview de como o corte vai sair na dimensão escolhida — com o quadro do
 * vídeo do usuário (arquivo ou thumb do link), o reenquadramento e a legenda.
 *
 * É uma aproximação: o servidor decide o corte exato (o rastreio de rosto
 * segue quem fala; aqui a "câmera" fica no centro). O que o preview responde é
 * a pergunta que fazia a pessoa gerar só para ver: "o que 9:16 faz com o meu
 * vídeo horizontal?" — o fundo desfocado com faixas ou o zoom no meio.
 */
function PreviewDoFormato({
  format,
  reframe,
  quadro,
  legenda,
}: {
  format: CutFormat;
  reframe: ReframeMode;
  quadro: string | null;
  legenda: { exemplo: string; preview: Record<string, string | number> } | null;
}) {
  const semQuadro = !quadro;
  const fundo = quadro
    ? `url(${quadro})`
    : 'linear-gradient(135deg, #3a3f63 0%, #6b4a7a 60%, #2a4a5c 100%)';
  // 16:9 é o formato de origem mais comum: sai sem reenquadrar.
  const modo: 'contain' | 'blur' | 'cover' =
    format === '16:9' ? 'contain' : reframe === 'blur' ? 'blur' : 'cover';
  return (
    <Stack direction="row" spacing={2} alignItems="center">
      <Box
        sx={{
          aspectRatio: PROPORCAO[format],
          height: 180,
          flexShrink: 0,
          borderRadius: 1.5,
          overflow: 'hidden',
          position: 'relative',
          bgcolor: '#000',
          border: '1px solid',
          borderColor: 'divider',
        }}
      >
        {modo === 'blur' && (
          <Box
            sx={{
              position: 'absolute',
              inset: -12,
              backgroundImage: fundo,
              backgroundSize: 'cover',
              backgroundPosition: 'center',
              filter: 'blur(10px) brightness(0.6)',
            }}
          />
        )}
        <Box
          sx={{
            position: 'absolute',
            inset: 0,
            backgroundImage: fundo,
            backgroundSize: modo === 'cover' ? 'cover' : 'contain',
            backgroundRepeat: 'no-repeat',
            backgroundPosition: 'center',
            // Sem quadro real, o gradiente ocupa a área que o vídeo ocuparia.
            ...(semQuadro && modo !== 'cover'
              ? { inset: modo === 'blur' ? '30% 0' : 0 }
              : {}),
          }}
        />
        {legenda && (
          <Box
            sx={{
              position: 'absolute',
              left: 0,
              right: 0,
              bottom: '12%',
              px: 1,
              textAlign: 'center',
              fontSize: format === '16:9' ? 11 : 12,
              lineHeight: 1.15,
              fontFamily: '"DejaVu Sans", Arial, sans-serif',
              ...legenda.preview,
            }}
          >
            {legenda.exemplo}
          </Box>
        )}
      </Box>
      <Typography variant="caption" color="text.secondary">
        {semQuadro
          ? 'Escolha um vídeo para ver o preview com o seu quadro.'
          : modo === 'contain'
            ? 'Sai como foi gravado, sem reenquadrar.'
            : modo === 'blur'
              ? 'O vídeo inteiro no meio, sobre o fundo desfocado.'
              : 'Zoom no centro; na geração, a câmera segue quem fala.'}
      </Typography>
    </Stack>
  );
}

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
  // Quadro do arquivo escolhido, só para o preview de formato.
  const [quadro, setQuadro] = useState<string | null>(null);
  // Fonte por arquivo ou por link — só um dos dois vale na hora de gerar.
  const [origem, setOrigem] = useState<'arquivo' | 'link'>('arquivo');
  const [url, setUrl] = useState('');
  const [infoLink, setInfoLink] = useState<InfoDoLink | null>(null);
  const [buscandoLink, setBuscandoLink] = useState(false);
  const [captionStyle, setCaptionStyle] = useState<CaptionStyle>('classico');
  const [reframe, setReframe] = useState<ReframeMode>('rosto');
  const [capacidades, setCapacidades] = useState<CutCapabilities>({
    urlImport: false,
    faceTracking: false,
  });
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

  // O que o servidor oferece (aba de link, seguir rosto) — uma vez.
  useEffect(() => {
    cutsService
      .capabilities()
      .then(setCapacidades)
      .catch(() => undefined);
  }, []);

  // Duração da fonte escolhida: do arquivo (lida no navegador) ou do link.
  const duracaoDaFonte = origem === 'link' ? (infoLink?.duracaoSeg ?? null) : duracao;

  // Cotação: muda com o modo, a quantidade e a duração da fonte.
  useEffect(() => {
    let vivo = true;
    cutsService
      .quote(mode, quantity, duracaoDaFonte ?? undefined)
      .then((q) => vivo && setQuote(q))
      .catch(() => vivo && setQuote(null));
    return () => {
      vivo = false;
    };
  }, [mode, quantity, duracaoDaFonte]);

  // Prévia do link, com atraso para não consultar a cada tecla.
  useEffect(() => {
    if (origem !== 'link') return;
    const limpo = url.trim();
    setInfoLink(null);
    if (!/^https?:\/\/\S+$/i.test(limpo)) return;
    let vivo = true;
    setBuscandoLink(true);
    const timer = setTimeout(() => {
      cutsService
        .urlInfo(limpo)
        .then((info) => {
          if (!vivo) return;
          setInfoLink(info);
          setErro(info.cabe ? null : info.motivo);
        })
        .catch((error) => vivo && setErro(mensagemDeErro(error)))
        .finally(() => vivo && setBuscandoLink(false));
    }, 600);
    return () => {
      vivo = false;
      clearTimeout(timer);
    };
  }, [origem, url]);

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
    setQuadro(f ? await capturarQuadroDoVideo(f) : null);
  }

  const duracaoFora =
    duracao !== null &&
    (duracao < LIMITES_DE_CORTE.fonteMinSeg || duracao > LIMITES_DE_CORTE.fonteMaxSeg);

  async function enviar() {
    const fontePronta = origem === 'link' ? Boolean(infoLink?.cabe) : Boolean(file);
    if (!fontePronta || !quote || enviandoRef.current) return;
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
      const pedido = {
        mode,
        format,
        quantity,
        minSeconds: faixa[0],
        maxSeconds: faixa[1],
        captions: mode === 'inteligente' && captions,
        captionStyle,
        reframe,
      };
      const job =
        origem === 'link'
          ? await cutsService.createFromUrl({ ...pedido, url: url.trim() })
          : await cutsService.create(pedido, file as File, setProgresso);
      setFile(null);
      setQuadro(null);
      setDuracao(null);
      setUrl('');
      setInfoLink(null);
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

  async function cancelar(id: string) {
    const ok = await confirmarApagar({
      titulo: 'Cancelar os cortes que ainda não saíram?',
      mensagem:
        'Os cortes já prontos ficam. Os que não foram gerados são estornados para a sua carteira. O corte que estiver no meio termina antes de parar.',
      textoConfirmar: 'Cancelar cortes',
      destrutivo: true,
    });
    if (!ok) return;
    try {
      await cutsService.cancel(id);
      await carregarJobs();
      if (selecionado?.id === id) setSelecionado(await cutsService.get(id));
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
                  {capacidades.urlImport && (
                    <ToggleButtonGroup
                      exclusive
                      size="small"
                      value={origem}
                      onChange={(_, v: 'arquivo' | 'link' | null) => v && setOrigem(v)}
                      sx={{ mb: 1.5 }}
                    >
                      <ToggleButton value="arquivo">
                        <UploadRoundedIcon fontSize="small" sx={{ mr: 0.5 }} /> Enviar arquivo
                      </ToggleButton>
                      <ToggleButton value="link">
                        <LinkRoundedIcon fontSize="small" sx={{ mr: 0.5 }} /> Link do YouTube
                      </ToggleButton>
                    </ToggleButtonGroup>
                  )}
                  {origem === 'arquivo' ? (
                    <>
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
                    </>
                  ) : (
                    <>
                      <TextField
                        size="small"
                        fullWidth
                        placeholder="https://www.youtube.com/watch?v=…"
                        value={url}
                        onChange={(e) => setUrl(e.target.value)}
                        disabled={enviando}
                        InputProps={{
                          endAdornment: buscandoLink ? <CircularProgress size={16} /> : undefined,
                        }}
                        helperText="Vídeo público de 2 a 60 min. O download acontece no servidor."
                      />
                      {infoLink && (
                        <Stack
                          direction="row"
                          spacing={1.25}
                          alignItems="center"
                          sx={{ mt: 1, p: 1, border: '1px solid', borderColor: 'divider', borderRadius: 1.5 }}
                        >
                          {infoLink.thumb && (
                            <Box
                              component="img"
                              src={infoLink.thumb}
                              alt=""
                              sx={{ width: 96, height: 54, objectFit: 'cover', borderRadius: 1, flexShrink: 0 }}
                            />
                          )}
                          <Box sx={{ minWidth: 0 }}>
                            <Typography variant="body2" noWrap sx={{ fontWeight: 600 }}>
                              {infoLink.titulo}
                            </Typography>
                            <Typography variant="caption" color={infoLink.cabe ? 'text.secondary' : 'error'}>
                              {infoLink.duracaoSeg !== null
                                ? `Duração: ${formatarTempo(infoLink.duracaoSeg)}`
                                : 'Duração desconhecida'}
                              {' · '}
                              {infoLink.plataforma}
                            </Typography>
                          </Box>
                        </Stack>
                      )}
                    </>
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
                    <PreviewDoFormato
                      format={format}
                      reframe={capacidades.faceTracking ? reframe : 'blur'}
                      quadro={origem === 'link' ? (infoLink?.thumb ?? null) : quadro}
                      legenda={
                        mode === 'inteligente' && captions
                          ? (ESTILOS_DE_LEGENDA.find((e) => e.id === captionStyle) ?? null)
                          : null
                      }
                    />
                    {format !== '16:9' && (
                      <Box>
                        <Typography variant="body2" sx={{ mb: 0.5 }}>
                          Vídeo gravado na horizontal
                        </Typography>
                        <ToggleButtonGroup
                          exclusive
                          size="small"
                          value={capacidades.faceTracking ? reframe : 'blur'}
                          onChange={(_, v: ReframeMode | null) => v && setReframe(v)}
                        >
                          <ToggleButton value="rosto" disabled={!capacidades.faceTracking}>
                            Seguir quem fala
                          </ToggleButton>
                          <ToggleButton value="blur">Vídeo inteiro + fundo desfocado</ToggleButton>
                        </ToggleButtonGroup>
                        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>
                          {reframe === 'rosto' && capacidades.faceTracking
                            ? 'O corte acompanha o rosto de quem aparece. Se não achar rosto, usa o fundo desfocado.'
                            : 'Nada é cortado: o vídeo fica centralizado sobre uma versão desfocada dele mesmo.'}
                        </Typography>
                      </Box>
                    )}
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
                    {mode === 'inteligente' && captions && (
                      <Box>
                        <Typography variant="body2" sx={{ mb: 0.75 }}>
                          Estilo da legenda
                        </Typography>
                        <Grid container spacing={1}>
                          {ESTILOS_DE_LEGENDA.map((e) => {
                            const ativo = captionStyle === e.id;
                            return (
                              <Grid item xs={6} sm={4} key={e.id}>
                                <Tooltip title={e.dica}>
                                  <Box
                                    onClick={() => setCaptionStyle(e.id)}
                                    sx={{
                                      cursor: 'pointer',
                                      border: '2px solid',
                                      borderColor: ativo ? 'primary.main' : 'divider',
                                      borderRadius: 1.5,
                                      overflow: 'hidden',
                                    }}
                                  >
                                    <Box
                                      sx={{
                                        height: 56,
                                        display: 'grid',
                                        placeItems: 'center',
                                        px: 1,
                                        background:
                                          'linear-gradient(135deg, #3a3f63 0%, #6b4a7a 60%, #2a4a5c 100%)',
                                      }}
                                    >
                                      <Box
                                        sx={{
                                          fontSize: 12,
                                          lineHeight: 1.15,
                                          textAlign: 'center',
                                          fontFamily: '"DejaVu Sans", Arial, sans-serif',
                                          ...e.preview,
                                        }}
                                      >
                                        {e.id === 'karaoke' ? (
                                          <>
                                            Olha <Box component="span" sx={{ color: '#FFD500' }}>só</Box> esse preço
                                          </>
                                        ) : e.id === 'oferta' ? (
                                          <>
                                            SÓ HOJE POR{' '}
                                            <Box component="span" sx={{ color: '#FFD500' }}>R$ 49,90</Box>
                                          </>
                                        ) : (
                                          e.exemplo
                                        )}
                                      </Box>
                                    </Box>
                                    <Typography
                                      variant="caption"
                                      sx={{ display: 'block', textAlign: 'center', py: 0.5, fontWeight: ativo ? 700 : 500 }}
                                    >
                                      {e.nome}
                                    </Typography>
                                  </Box>
                                </Tooltip>
                              </Grid>
                            );
                          })}
                        </Grid>
                      </Box>
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
                  disabled={
                    (origem === 'link' ? !infoLink?.cabe : !file || duracaoFora) ||
                    enviando ||
                    !quote
                  }
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
                        {j.status === 'processando' && (
                          <Tooltip title="Cancelar os cortes que ainda não saíram">
                            <IconButton
                              size="small"
                              onClick={(e) => {
                                e.stopPropagation();
                                void cancelar(j.id);
                              }}
                            >
                              <StopCircleRoundedIcon fontSize="small" />
                            </IconButton>
                          </Tooltip>
                        )}
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
  // Melhor primeiro quando há nota (modo inteligente); senão a ordem da fonte.
  const ordenados = [...job.clips].sort(
    (a, b) => (b.score ?? -1) - (a.score ?? -1) || a.position - b.position,
  );
  const melhor =
    job.status === 'pronto'
      ? (ordenados.find((c) => c.status === 'pronto' && c.score !== null) ?? null)
      : null;
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
        {job.status === 'pronto' && job.error && (
          <Alert severity="info" sx={{ mb: 2 }}>
            {job.error}
          </Alert>
        )}
        {job.status === 'processando' && <LoaderDoJob job={job} />}

        {job.status === 'pronto' && prontos > 0 && (
          <Alert
            severity="success"
            icon={<EmojiEventsRoundedIcon fontSize="inherit" />}
            sx={{ mb: 2 }}
          >
            Encontramos {prontos} {prontos === 1 ? 'corte' : 'cortes'}
            {melhor?.score !== null && melhor?.score !== undefined
              ? ` — o melhor é o #${melhor.position} (nota ${melhor.score}/10)`
              : ''}
            {melhor?.reason ? `: ${melhor.reason}` : '.'}
          </Alert>
        )}

        <Grid container spacing={2}>
          {ordenados.map((c) => (
            <Grid item xs={12} sm={6} key={c.id}>
              <CardDoCorte clip={c} job={job} melhor={melhor?.id === c.id} />
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

function CardDoCorte({
  clip,
  job,
  melhor = false,
}: {
  clip: CutClip;
  job: CutJobDetail;
  /** Destaque visual do corte com a maior nota do job. */
  melhor?: boolean;
}) {
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
              <Chip
                size="small"
                variant={melhor ? 'filled' : 'outlined'}
                color={melhor ? 'success' : 'default'}
                icon={melhor ? <EmojiEventsRoundedIcon /> : <AutoAwesomeRoundedIcon />}
                label={clip.score !== null ? `${melhor ? 'Melhor · ' : ''}${clip.score}/10` : 'IA'}
              />
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
        {clip.reason && (
          <Typography variant="caption" sx={{ display: 'block', mt: 0.5, color: 'success.main' }}>
            Por que esse: {clip.reason}
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
