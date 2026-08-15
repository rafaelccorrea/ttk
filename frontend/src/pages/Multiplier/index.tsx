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
import CheckCircleRoundedIcon from '@mui/icons-material/CheckCircleRounded';
import CloseRoundedIcon from '@mui/icons-material/CloseRounded';
import ContentCopyRoundedIcon from '@mui/icons-material/ContentCopyRounded';
import DeleteOutlineRoundedIcon from '@mui/icons-material/DeleteOutlineRounded';
import DownloadRoundedIcon from '@mui/icons-material/DownloadRounded';
import DynamicFeedRoundedIcon from '@mui/icons-material/DynamicFeedRounded';
import ExpandLessRoundedIcon from '@mui/icons-material/ExpandLessRounded';
import ExpandMoreRoundedIcon from '@mui/icons-material/ExpandMoreRounded';
import LockRoundedIcon from '@mui/icons-material/LockRounded';
import MovieFilterRoundedIcon from '@mui/icons-material/MovieFilterRounded';
import UploadRoundedIcon from '@mui/icons-material/UploadRounded';
import { DragEvent, FormEvent, useEffect, useRef, useState } from 'react';
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

/**
 * Definição de cada bloco da fórmula, num lugar só.
 *
 * `letra` é a que aparece no nome do arquivo (G1C2A3) e vem do `expand()` do
 * servidor. Antes a tela derivava a letra do título — e como "Corpos" e "CTAs"
 * começam com C, o CTA aparecia rotulado como "C1" enquanto o arquivo saía
 * "A1". Aqui a letra é declarada, não adivinhada.
 *
 * A cor é informação, não enfeite: é a mesma no bloco, na barra da fórmula e
 * na tabela de resultados, então dá para rastrear de onde veio cada pedaço de
 * um vídeo montado sem ler texto nenhum.
 */
const BLOCOS = [
  {
    role: 'hook' as const,
    letra: 'G',
    titulo: 'Ganchos',
    emoji: '🎣',
    max: 10,
    cor: '#fe2c55',
    ajuda: 'Os 3 primeiros segundos. É o bloco que decide o scroll.',
  },
  {
    role: 'body' as const,
    letra: 'C',
    titulo: 'Corpos',
    emoji: '📝',
    max: 5,
    cor: '#25f4ee',
    ajuda: 'Demonstração e prova — o miolo do vídeo.',
  },
  {
    role: 'cta' as const,
    letra: 'A',
    titulo: 'CTAs',
    emoji: '🎯',
    max: 3,
    cor: '#ffb020',
    ajuda: 'O comando final para tocar no carrinho.',
  },
];

/** Teto do backend (`MaxFileSizeValidator`), replicado para recusar antes de subir. */
const MAX_BYTES = 40 * 1024 * 1024;

/** Teto de montagem do backend (`MAX_VIDEOS_POR_MONTAGEM`). */
const MAX_VIDEOS = 60;

function truncate(text: string, max = 30) {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

/**
 * Tamanho legível.
 *
 * Fixar em MB mostrava "0.0 MB" para um clipe de 24 KB, o que parece arquivo
 * corrompido. A unidade acompanha a grandeza.
 */
function formatarTamanho(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/**
 * Checa o arquivo ANTES de subir.
 *
 * Sem isto, um clipe de 200 MB gasta o upload inteiro para tomar um 413, e num
 * bloco de 10 ganchos isso é o tipo de espera que faz o vendedor achar que a
 * ferramenta travou.
 */
function validarClipe(file: File): string | null {
  if (!file.type.startsWith('video/')) return `"${file.name}" não é um vídeo.`;
  if (file.size > MAX_BYTES) {
    return `"${file.name}" tem ${formatarTamanho(file.size)}. O limite é 40 MB.`;
  }
  return null;
}

/** Cabeçalho de passo — a tela é uma sequência, e a numeração diz isso. */
function Passo({
  numero,
  titulo,
  descricao,
  concluido,
}: {
  numero: number;
  titulo: string;
  descricao: string;
  concluido?: boolean;
}) {
  return (
    <Stack direction="row" spacing={1.5} alignItems="flex-start" sx={{ mb: 2 }}>
      <Box
        sx={{
          width: 26,
          height: 26,
          flexShrink: 0,
          borderRadius: '50%',
          display: 'grid',
          placeItems: 'center',
          fontSize: 13,
          fontWeight: 700,
          bgcolor: concluido ? 'success.main' : 'action.selected',
          color: concluido ? '#fff' : 'text.secondary',
          transition: 'background-color .2s',
        }}
      >
        {concluido ? <CheckCircleRoundedIcon sx={{ fontSize: 18 }} /> : numero}
      </Box>
      <Box sx={{ minWidth: 0 }}>
        <Typography variant="subtitle2" fontWeight={700}>
          {titulo}
        </Typography>
        <Typography variant="caption" color="text.secondary">
          {descricao}
        </Typography>
      </Box>
    </Stack>
  );
}

interface ClipDropzoneProps {
  bloco: (typeof BLOCOS)[number];
  clips: CombinationClip[];
  busy: boolean;
  disabled?: boolean;
  /** `undefined` no gancho: ele é obrigatório e não tem chave. */
  onToggle?: (ligado: boolean) => void;
  onUpload: (files: FileList | null) => void;
  onRemove: (id: string) => void;
}

/**
 * Um bloco da fórmula com os vídeos de verdade.
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
  bloco,
  clips,
  busy,
  disabled,
  onToggle,
  onUpload,
  onRemove,
}: ClipDropzoneProps) {
  const [arrastando, setArrastando] = useState(false);
  const cheio = clips.length >= bloco.max;

  return (
    <Box
      sx={{
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        borderRadius: 2,
        overflow: 'hidden',
        border: '1px solid',
        borderColor: disabled ? 'divider' : 'divider',
        bgcolor: 'background.paper',
        opacity: disabled ? 0.5 : 1,
        transition: 'opacity .2s',
      }}
    >
      {/* Cabeçalho na cor do bloco: é a mesma cor da fórmula e dos códigos na
          tabela, então dá para rastrear a peça sem ler texto. A chave de
          liga/desliga fica AQUI, no próprio bloco — a linha de switches
          separada não deixava claro qual chave pertencia a qual rótulo. */}
      <Stack
        direction="row"
        alignItems="center"
        spacing={1}
        sx={{
          px: 1.25,
          py: 0.75,
          bgcolor: disabled ? 'action.disabledBackground' : bloco.cor,
          color: disabled ? 'text.disabled' : '#fff',
        }}
      >
        <Typography variant="subtitle2" fontWeight={700} sx={{ flexGrow: 1 }}>
          {bloco.emoji} {bloco.titulo}
        </Typography>
        <Box
          sx={{
            px: 0.75,
            borderRadius: 5,
            fontSize: 11,
            fontWeight: 700,
            bgcolor: 'rgba(255,255,255,0.25)',
          }}
        >
          {clips.length}/{bloco.max}
        </Box>
        {onToggle ? (
          <Switch
            size="small"
            checked={!disabled}
            onChange={(e) => onToggle(e.target.checked)}
            inputProps={{ 'aria-label': `Usar ${bloco.titulo}` }}
            sx={{ ml: -0.5 }}
          />
        ) : (
          // O gancho não desliga: sem ele não há vídeo nem código de arquivo.
          <Tooltip title="O gancho é obrigatório">
            <LockRoundedIcon sx={{ fontSize: 15, opacity: 0.7 }} />
          </Tooltip>
        )}
      </Stack>

      <Box sx={{ p: 1.25, flexGrow: 1, display: 'flex', flexDirection: 'column' }}>
        <Typography variant="caption" color="text.secondary" display="block" mb={1}>
          {bloco.ajuda}
        </Typography>

        <Stack spacing={0.5} sx={{ mb: clips.length ? 1 : 0 }}>
          {clips.map((clip, index) => (
            <Stack
              key={clip.id}
              direction="row"
              spacing={0.75}
              alignItems="center"
              sx={{ px: 0.75, py: 0.5, borderRadius: 1, bgcolor: 'action.hover' }}
            >
              {/* A posição vira o código do arquivo (G1, C2, A3), então
                  mostrá-la aqui é o que liga esta lista aos resultados. */}
              <Box
                sx={{
                  px: 0.6,
                  py: 0.15,
                  borderRadius: 0.75,
                  fontSize: 10,
                  fontWeight: 700,
                  fontFamily: 'monospace',
                  color: '#fff',
                  bgcolor: bloco.cor,
                  flexShrink: 0,
                }}
              >
                {bloco.letra}
                {index + 1}
              </Box>
              <Tooltip title={`${clip.label} · ${formatarTamanho(clip.sizeBytes)}`}>
                <Typography
                  variant="caption"
                  noWrap
                  sx={{ flexGrow: 1, minWidth: 0, fontSize: 11 }}
                >
                  {clip.label}
                </Typography>
              </Tooltip>
              <IconButton
                size="small"
                aria-label={`Remover ${clip.label}`}
                onClick={() => onRemove(clip.id)}
                sx={{ p: 0.25 }}
              >
                <CloseRoundedIcon sx={{ fontSize: 14 }} />
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
              mt: 'auto',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 0.25,
              py: 1.5,
              px: 1,
              textAlign: 'center',
              cursor: busy ? 'progress' : 'pointer',
              border: '1px dashed',
              borderColor: arrastando ? bloco.cor : 'divider',
              bgcolor: arrastando ? 'action.selected' : 'transparent',
              borderRadius: 1.5,
              transition: 'border-color .15s, background-color .15s',
              '&:hover': { borderColor: busy ? 'divider' : bloco.cor },
            }}
          >
            {busy ? (
              <CircularProgress size={18} />
            ) : (
              <UploadRoundedIcon sx={{ fontSize: 20 }} color="action" />
            )}
            <Typography variant="caption" color="text.secondary" sx={{ fontSize: 11 }}>
              {busy ? 'Enviando...' : 'Arraste ou clique'}
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
 * A montagem é sequencial e leva minutos numa matriz grande. Um spinner geral
 * esconderia o que interessa: os primeiros vídeos já ficam prontos para baixar
 * enquanto os últimos ainda estão na fila.
 */
function RenderProgress({ videos }: { videos: CombinationVideo[] }) {
  const prontos = videos.filter((v) => v.status === 'pronto').length;
  const falhas = videos.filter((v) => v.status === 'falhou').length;
  const terminou = prontos + falhas === videos.length;

  return (
    <Box>
      <Stack direction="row" alignItems="center" spacing={1.5} sx={{ mb: 1.5 }}>
        <Box sx={{ flexGrow: 1 }}>
          <LinearProgress
            variant="determinate"
            value={((prontos + falhas) / videos.length) * 100}
            color={falhas > 0 ? 'warning' : 'primary'}
            sx={{ height: 8, borderRadius: 4 }}
          />
        </Box>
        <Typography variant="body2" fontWeight={700}>
          {prontos + falhas}/{videos.length}
        </Typography>
      </Stack>

      {terminou && falhas === 0 && (
        <Alert severity="success" sx={{ mb: 1.5 }}>
          {prontos} vídeos prontos para postar.
        </Alert>
      )}
      {falhas > 0 && (
        <Alert severity="warning" sx={{ mb: 1.5 }}>
          {falhas} vídeo(s) falharam na montagem. Os demais continuam
          disponíveis — passe o mouse no status para ver o motivo.
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
                  <CodigoChip code={v.code} />
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

/**
 * `G1C2A3` colorido por bloco.
 *
 * Cada par letra+número ganha a cor do seu bloco, então o código deixa de ser
 * uma sigla opaca e passa a mostrar a composição do vídeo de relance.
 */
function CodigoChip({ code }: { code: string }) {
  const partes = code.match(/[A-Z]\d+/g) ?? [code];
  return (
    <Stack direction="row" spacing={0.25}>
      {partes.map((parte) => {
        const bloco = BLOCOS.find((b) => b.letra === parte[0]);
        return (
          <Box
            key={parte}
            sx={{
              px: 0.6,
              py: 0.2,
              borderRadius: 0.75,
              fontSize: 11,
              fontWeight: 700,
              fontFamily: 'monospace',
              color: '#fff',
              bgcolor: bloco?.cor ?? 'text.disabled',
            }}
          >
            {parte}
          </Box>
        );
      })}
    </Stack>
  );
}

/**
 * Tudo que o usuário já montou, num lugar só.
 *
 * Sem isto, o vídeo montado só existia enquanto a aba ficasse aberta: saiu da
 * tela, perdeu o link. Como cada montagem custa minutos de ffmpeg, refazer era
 * o único caminho de volta — e o arquivo continuava lá no bucket o tempo todo.
 *
 * A prévia usa `<video preload="metadata">`: baixa só o cabeçalho e mostra o
 * primeiro quadro, em vez de puxar dezenas de MP4 inteiros ao abrir a aba.
 */
function Galeria({
  videos,
  onRecarregar,
}: {
  videos: CombinationVideo[];
  onRecarregar: () => void;
}) {
  const prontos = videos.filter((v) => v.status === 'pronto' && v.url);

  return (
    <Card>
      <CardContent>
        <Stack direction="row" alignItems="center" sx={{ mb: 2 }}>
          <Box sx={{ flexGrow: 1 }}>
            <Typography variant="h6">Meus vídeos</Typography>
            <Typography variant="caption" color="text.secondary">
              {prontos.length
                ? `${prontos.length} vídeo(s) montados e prontos para postar`
                : 'Os vídeos que você montar ficam guardados aqui'}
            </Typography>
          </Box>
          <Button size="small" onClick={onRecarregar}>
            Atualizar
          </Button>
        </Stack>

        {prontos.length === 0 ? (
          <Typography variant="body2" color="text.secondary">
            Nenhum vídeo montado ainda. Gere uma matriz e clique em “Montar
            vídeos”.
          </Typography>
        ) : (
          <Grid container spacing={1.5}>
            {prontos.map((v) => (
              <Grid item xs={6} sm={4} md={3} key={v.id}>
                <Box
                  sx={{
                    borderRadius: 1.5,
                    overflow: 'hidden',
                    border: '1px solid',
                    borderColor: 'divider',
                    bgcolor: '#000',
                  }}
                >
                  <Box
                    component="video"
                    src={resolveApiUrl(v.url!)}
                    controls
                    preload="metadata"
                    sx={{
                      width: '100%',
                      aspectRatio: '9 / 16',
                      display: 'block',
                      objectFit: 'contain',
                      bgcolor: '#000',
                    }}
                  />
                  <Box sx={{ p: 1, bgcolor: 'background.paper' }}>
                    <Stack direction="row" alignItems="center" spacing={0.5} mb={0.5}>
                      <CodigoChip code={v.code} />
                    </Stack>
                    <Tooltip title={v.filename}>
                      <Typography
                        variant="caption"
                        noWrap
                        display="block"
                        sx={{ fontFamily: 'monospace', fontSize: 10 }}
                      >
                        {v.filename}
                      </Typography>
                    </Tooltip>
                    <Button
                      fullWidth
                      size="small"
                      component="a"
                      href={resolveApiUrl(v.url!)}
                      download={v.filename}
                      target="_blank"
                      rel="noopener"
                      startIcon={<DownloadRoundedIcon />}
                      sx={{ mt: 0.5 }}
                    >
                      Baixar
                    </Button>
                  </Box>
                </Box>
              </Grid>
            ))}
          </Grid>
        )}
      </CardContent>
    </Card>
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
  const [galeria, setGaleria] = useState<CombinationVideo[]>([]);
  const [montando, setMontando] = useState(false);

  function recarregarGaleria() {
    combinationsService.gallery().then(setGaleria).catch(console.error);
  }
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
    combinationsService.gallery().then(setGaleria).catch(console.error);
  }, []);

  const ligado: Record<ClipRole, boolean> = {
    hook: true,
    body: usarCorpo,
    cta: usarCta,
  };
  const doBloco = (role: ClipRole) =>
    ligado[role] ? clips.filter((c) => c.role === role) : [];

  const counts = {
    hooks: doBloco('hook').length,
    bodies: doBloco('body').length,
    ctas: doBloco('cta').length,
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

    const bloco = BLOCOS.find((b) => b.role === role)!;
    const cabem = bloco.max - clips.filter((c) => c.role === role).length;
    if (lista.length > cabem) {
      setError(`Cabem mais ${cabem} vídeo(s) em ${bloco.titulo}.`);
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
      // a banda e o servidor recebe vários multipart de 40 MB de uma só vez.
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
        hooks: doBloco('hook').map((c) => c.label),
        bodies: doBloco('body').map((c) => c.label),
        ctas: doBloco('cta').map((c) => c.label),
        hookClipIds: doBloco('hook').map((c) => c.id),
        bodyClipIds: doBloco('body').map((c) => c.id),
        ctaClipIds: doBloco('cta').map((c) => c.id),
      });
      setResult(plan);
      setVideos([]);
      setPlans((prev) => [{ ...plan, total: plan.combinations.length }, ...prev]);
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
            // Os arquivos novos entram na galeria assim que ficam prontos.
            recarregarGaleria();
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
    // BOM na frente: sem ele o Excel em pt-BR abre o CSV em ANSI e os acentos
    // dos rótulos viram lixo.
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
    if (result?.id === id) {
      setResult(null);
      setVideos([]);
    }
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
                  <CodigoChip code={c.code} />
                </TableCell>
                <TableCell sx={{ fontFamily: 'monospace', fontSize: 12 }}>
                  {c.filename}
                </TableCell>
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

      <form onSubmit={handleSubmit}>
        {/* Passos 1 e 2 ocupam a largura toda: os três blocos de clipes
            precisam caber lado a lado, e numa coluna de 5/12 eles ficavam
            espremidos ou empilhados numa fita vertical interminável. */}
        <Card sx={{ mb: 2 }}>
          <CardContent>
            <Passo
              numero={1}
              titulo="Identifique o produto"
              descricao="A sigla nomeia todos os arquivos gerados."
              concluido={Boolean(sigla.trim())}
            />
            <Grid container spacing={2} alignItems="flex-start">
              <Grid item xs={12} sm={5}>
                <TextField
                  fullWidth
                  required
                  size="small"
                  label="Sigla do produto"
                  placeholder="Ex.: CINTA"
                  value={sigla}
                  inputProps={{ maxLength: 10, style: { textTransform: 'uppercase' } }}
                  onChange={(e) => setSigla(e.target.value)}
                  helperText={`Arquivos: ${sigla.trim().toUpperCase() || '[SIGLA]'}_G1C2A3_DDMM.mp4`}
                />
              </Grid>
              <Grid item xs={12} sm={7}>
                <Typography variant="caption" color="text.secondary" display="block" mb={0.5}>
                  Formato de saída
                </Typography>
                <ToggleButtonGroup
                  exclusive
                  fullWidth
                  size="small"
                  value={format}
                  onChange={(_e, value) => value && setFormat(value)}
                >
                  <ToggleButton value="9:16">9:16 Vertical</ToggleButton>
                  <ToggleButton value="16:9">16:9 Horizontal</ToggleButton>
                  <ToggleButton value="1:1">1:1 Quadrado</ToggleButton>
                </ToggleButtonGroup>
              </Grid>
            </Grid>
          </CardContent>
        </Card>

        <Card sx={{ mb: 2 }}>
          <CardContent>
            <Passo
              numero={2}
              titulo="Suba seus clipes"
              descricao="Cada bloco vira uma peça da combinação. Desligue Corpo ou CTA pela chave no cabeçalho."
              concluido={counts.hooks > 0}
            />

                {/* Lado a lado: os três blocos são a mesma coisa em paralelo,
                    não uma sequência. Empilhados eles viravam uma coluna longa
                    que escondia o passo 3 abaixo da dobra. */}
                <Grid container spacing={1.5} alignItems="stretch">
                  {BLOCOS.map((bloco) => (
                    <Grid item xs={12} sm={4} key={bloco.role}>
                      <ClipDropzone
                        bloco={bloco}
                        clips={clips.filter((c) => c.role === bloco.role)}
                        busy={enviando === bloco.role}
                        disabled={!ligado[bloco.role]}
                        onToggle={
                          bloco.role === 'body'
                            ? setUsarCorpo
                            : bloco.role === 'cta'
                              ? setUsarCta
                              : undefined
                        }
                        onUpload={(files) => void handleUpload(bloco.role, files)}
                        onRemove={(id) => void handleRemoveClip(id)}
                      />
                    </Grid>
                  ))}
                </Grid>
          </CardContent>
        </Card>

        <Grid container spacing={3}>
          <Grid item xs={12} md={5}>
            <Card>
              <CardContent>
                <Passo
                  numero={3}
                  titulo="Gere a matriz"
                  descricao="Todas as combinações possíveis, de uma vez."
                  concluido={Boolean(result)}
                />

                {/* A conta com as cores dos blocos: mostra de onde sai cada
                    fator, não só o número final. */}
                <Stack
                  direction="row"
                  alignItems="center"
                  justifyContent="center"
                  spacing={1}
                  sx={{ mb: 2 }}
                >
                  {BLOCOS.map((bloco, i) => (
                    <Stack key={bloco.role} direction="row" alignItems="center" spacing={1}>
                      {i > 0 && (
                        <Typography variant="h6" color="text.disabled">
                          ×
                        </Typography>
                      )}
                      <Box sx={{ textAlign: 'center' }}>
                        <Typography
                          variant="h5"
                          fontWeight={700}
                          sx={{
                            color: ligado[bloco.role] ? bloco.cor : 'text.disabled',
                          }}
                        >
                          {Math.max(
                            bloco.role === 'hook'
                              ? counts.hooks
                              : bloco.role === 'body'
                                ? counts.bodies
                                : counts.ctas,
                            bloco.role === 'hook' ? 0 : 1,
                          )}
                        </Typography>
                        <Typography variant="caption" color="text.secondary">
                          {bloco.letra}
                        </Typography>
                      </Box>
                    </Stack>
                  ))}
                  <Typography variant="h6" color="text.disabled">
                    =
                  </Typography>
                  <Box sx={{ textAlign: 'center' }}>
                    <Typography
                      variant="h4"
                      fontWeight={800}
                      color={total > 0 ? 'text.primary' : 'text.disabled'}
                    >
                      {total}
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                      vídeos
                    </Typography>
                  </Box>
                </Stack>

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
                    <Box>
                      <Typography variant="h6">
                        {result.sigla} — {result.combinations.length} combinações
                      </Typography>
                      <Typography variant="caption" color="text.secondary">
                        {result.format} ·{' '}
                        {videos.length
                          ? 'montagem em vídeo'
                          : 'matriz gerada — clique em Montar vídeos'}
                      </Typography>
                    </Box>
                    <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
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
                        CSV
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
                    Seus vídeos aparecerão aqui
                  </Typography>
                  <Typography
                    variant="body2"
                    color="text.secondary"
                    sx={{ maxWidth: 420, mx: 'auto' }}
                  >
                    Suba 3 ganchos, 2 corpos e 1 CTA e saia com 6 vídeos
                    diferentes — cada um com o nome pronto para você saber qual
                    performou no teste A/B.
                  </Typography>
                </Box>
              )}
            </CardContent>
          </Card>
          </Grid>
        </Grid>
      </form>

      <Box sx={{ mt: 3 }}>
        <Galeria videos={galeria} onRecarregar={recarregarGaleria} />
      </Box>

      <Card sx={{ mt: 3 }}>
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
                            <Chip
                              size="small"
                              variant="outlined"
                              label={plan.format}
                              sx={{ ml: 0.5 }}
                            />
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
                                <Button
                                  size="small"
                                  startIcon={<MovieFilterRoundedIcon />}
                                  onClick={() => void handleRender(plan.id)}
                                >
                                  Montar vídeos
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
    </>
  );
}
