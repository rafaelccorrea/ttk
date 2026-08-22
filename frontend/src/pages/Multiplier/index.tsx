import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  Collapse,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  Grid,
  IconButton,
  LinearProgress,
  Menu,
  MenuItem,
  Stack,
  Step,
  StepButton,
  Stepper,
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
  useMediaQuery,
  useTheme,
} from '@mui/material';
import CheckCircleRoundedIcon from '@mui/icons-material/CheckCircleRounded';
import CloseRoundedIcon from '@mui/icons-material/CloseRounded';
import ContentCopyRoundedIcon from '@mui/icons-material/ContentCopyRounded';
import DeleteOutlineRoundedIcon from '@mui/icons-material/DeleteOutlineRounded';
import DownloadRoundedIcon from '@mui/icons-material/DownloadRounded';
import DynamicFeedRoundedIcon from '@mui/icons-material/DynamicFeedRounded';
import InsightsRoundedIcon from '@mui/icons-material/InsightsRounded';
import ExpandLessRoundedIcon from '@mui/icons-material/ExpandLessRounded';
import ExpandMoreRoundedIcon from '@mui/icons-material/ExpandMoreRounded';
import FolderOutlinedIcon from '@mui/icons-material/FolderOutlined';
import Forward5RoundedIcon from '@mui/icons-material/Forward5Rounded';
import LockRoundedIcon from '@mui/icons-material/LockRounded';
import MovieFilterRoundedIcon from '@mui/icons-material/MovieFilterRounded';
import Replay5RoundedIcon from '@mui/icons-material/Replay5Rounded';
import UploadRoundedIcon from '@mui/icons-material/UploadRounded';
import {
  DragEvent,
  FormEvent,
  SyntheticEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';
import { resolveApiUrl } from '@/services/api';
import { mensagemDeErro } from '@/services/erros';
import { useConfirmarGasto } from '@/hooks/useConfirmarGasto';
import { useSaldo } from '@/hooks/useSaldo';
import {
  ClipRole,
  Combination,
  CombinationClip,
  CombinationFolder,
  CombinationPlanDetail,
  CombinationPlanSummary,
  CombinationOriginality,
  CombinationVideo,
  GaleriaGrupo,
  CombinationVideoStatus,
  FAIXAS_DE_DURACAO,
  ORIGINALITY_HINT,
  ORIGINALITY_LABEL,
  PlanFormat,
  PlanoInsights,
  SituacaoDeDuracao,
  combinationsService,
  situacaoDaDuracao,
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
    // Cor do texto sobre `cor`: o vermelho aguenta branco; ciano e âmbar são
    // claros e precisam de texto escuro para ter contraste.
    texto: '#fff',
    ajuda: 'Os 3 primeiros segundos. É o bloco que decide o scroll.',
  },
  {
    role: 'body' as const,
    letra: 'C',
    titulo: 'Corpos',
    emoji: '📝',
    max: 5,
    cor: '#25f4ee',
    texto: '#161823',
    ajuda: 'Demonstração e prova — o miolo do vídeo.',
  },
  {
    role: 'cta' as const,
    letra: 'A',
    titulo: 'CTAs',
    emoji: '🎯',
    max: 3,
    cor: '#ffb020',
    texto: '#161823',
    ajuda: 'O comando final para tocar no carrinho.',
  },
];

/**
 * Créditos por vídeo montado (`ACTION_PRICES.assembly` no backend).
 *
 * A tela mostra a conta ANTES do clique: numa matriz cheia são 150 vídeos, e
 * descobrir o preço pelo extrato depois de montar é a pior hora de descobrir.
 */
const CREDITOS_POR_VIDEO = 1;

/**
 * Chave do grupo "Sem pasta" na visão por pasta.
 *
 * Não é um id de pasta de verdade — é o balde de quem ainda não foi
 * organizado, e precisa de uma chave que nenhum uuid possa colidir.
 */
const SEM_PASTA = 'sem-pasta';

/** Paleta das pastas — as mesmas cores dos blocos, mais neutros de apoio. */
const CORES_DE_PASTA = ['#fe2c55', '#25f4ee', '#ffb020', '#7c4dff', '#2ecc71'];

/** Concordância de número — "1 créditos" denuncia texto montado por concatenação. */
function plural(n: number, singular: string, plural: string): string {
  return n === 1 ? singular : plural;
}

/** Teto do backend (`MaxFileSizeValidator`), replicado para recusar antes de subir. */
const MAX_BYTES = 40 * 1024 * 1024;

/**
 * Teto de montagem do backend (`MAX_VIDEOS_POR_MONTAGEM`).
 *
 * É a matriz cheia dos blocos — 10 × 5 × 3. Nunca menos que isso: a tela
 * oferece os três limites, então recusar a combinação completa seria prometer
 * o que não se entrega.
 */
const MAX_VIDEOS = BLOCOS.reduce((total, bloco) => total * bloco.max, 1);

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
 * Duração em segundos, sempre curta.
 *
 * Os clipes vivem na casa dos segundos: "3,2s" cabe no selo ao lado do nome do
 * arquivo, e é a mesma unidade da fórmula (3s/10s/5s) que a tela ensina.
 */
function formatarDuracao(ms: number): string {
  const s = ms / 1000;
  return `${s < 10 ? s.toFixed(1) : Math.round(s)}s`;
}

/** Cor e explicação do selo de duração — a cor é o aviso, o texto é o porquê. */
const DURACAO_ESTILO: Record<
  SituacaoDeDuracao,
  { cor: 'success' | 'warning' | 'error' | 'default'; dica: string }
> = {
  ideal: { cor: 'success', dica: 'Dentro do tempo ideal deste bloco.' },
  'fora-da-faixa': {
    cor: 'warning',
    dica: 'Fora do tempo ideal — dá para montar, mas costuma render menos.',
  },
  'acima-do-limite': {
    cor: 'error',
    dica: 'Longo demais para este bloco: a montagem vai ser recusada.',
  },
  desconhecida: { cor: 'default', dica: 'Não foi possível medir a duração.' },
};

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
  /** Grava a etiqueta de produto do clipe. Vazio limpa. */
  onSetProduto: (id: string, produto: string) => void;
}

/**
 * Um bloco da fórmula com os vídeos de verdade.
 *
 * Antes isto era uma lista de campos de texto: o vendedor digitava o NOME do
 * clipe e a plataforma devolvia uma planilha de nomes de arquivo, deixando a
 * montagem de cada um dos 150 vídeos para ele fazer no celular. O trabalho que
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
  onSetProduto,
}: ClipDropzoneProps) {
  const [arrastando, setArrastando] = useState(false);
  // Edição inline da etiqueta de produto — um clipe por vez.
  const [editandoProduto, setEditandoProduto] = useState<string | null>(null);
  const [produtoRascunho, setProdutoRascunho] = useState('');
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
          color: disabled ? 'text.disabled' : bloco.texto,
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
            bgcolor:
              bloco.texto === '#fff'
                ? 'rgba(255,255,255,0.25)'
                : 'rgba(22,24,35,0.12)',
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
          {bloco.ajuda}{' '}
          <Box component="span" sx={{ fontWeight: 700, color: 'text.primary' }}>
            Alvo: {FAIXAS_DE_DURACAO[bloco.role].alvo}s.
          </Box>
        </Typography>

        <Stack spacing={0.5} sx={{ mb: clips.length ? 1 : 0 }}>
          {clips.map((clip, index) => (
            <Stack
              key={clip.id}
              direction="row"
              spacing={0.75}
              alignItems="center"
              useFlexGap
              sx={{
                px: 0.75,
                py: 0.5,
                borderRadius: 1,
                bgcolor: 'action.hover',
                flexWrap: 'wrap',
                rowGap: 0.5,
              }}
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
                  color: bloco.texto,
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
              {/* Etiqueta de produto: a lista de clipes é global e o nome do
                  arquivo raramente diz o produto — sem isto não dava para
                  saber qual produto aparece com o apresentador em cada
                  clipe. */}
              {editandoProduto === clip.id ? (
                <TextField
                  size="small"
                  autoFocus
                  value={produtoRascunho}
                  placeholder="Produto"
                  onChange={(e) => setProdutoRascunho(e.target.value)}
                  onBlur={() => {
                    onSetProduto(clip.id, produtoRascunho);
                    setEditandoProduto(null);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      onSetProduto(clip.id, produtoRascunho);
                      setEditandoProduto(null);
                    }
                    if (e.key === 'Escape') setEditandoProduto(null);
                  }}
                  inputProps={{
                    maxLength: 60,
                    style: { fontSize: 11, padding: '2px 6px' },
                    'aria-label': `Produto do clipe ${clip.label}`,
                  }}
                  sx={{ width: 96, flexShrink: 0 }}
                />
              ) : (
                <Tooltip
                  title={
                    clip.produto
                      ? `Produto: ${clip.produto}. Clique para editar.`
                      : 'Sem etiqueta de produto — clique para dizer de qual produto é este clipe.'
                  }
                >
                  <Chip
                    size="small"
                    label={clip.produto ?? 'produto?'}
                    variant={clip.produto ? 'filled' : 'outlined'}
                    color={clip.produto ? 'default' : 'warning'}
                    onClick={() => {
                      setProdutoRascunho(clip.produto ?? '');
                      setEditandoProduto(clip.id);
                    }}
                    sx={{
                      height: 17,
                      maxWidth: 96,
                      flexShrink: 0,
                      fontSize: 10,
                      fontWeight: 700,
                      '& .MuiChip-label': { px: 0.6 },
                    }}
                  />
                </Tooltip>
              )}
              {/* O selo de duração fica ao lado do código da peça porque é
                  exatamente aí que a decisão acontece: este G2 de 11s vai
                  entrar em 15 vídeos, e é agora — não depois de montar — que
                  trocar o arquivo ainda é de graça. */}
              {clip.durationMs > 0 &&
                (() => {
                  const estado = situacaoDaDuracao(clip.role, clip.durationMs);
                  const estilo = DURACAO_ESTILO[estado];
                  return (
                    <Tooltip
                      title={`${estilo.dica} Alvo do bloco: ${FAIXAS_DE_DURACAO[clip.role].alvo}s.`}
                    >
                      <Chip
                        size="small"
                        label={formatarDuracao(clip.durationMs)}
                        color={estilo.cor}
                        variant={estado === 'ideal' ? 'filled' : 'outlined'}
                        sx={{
                          height: 17,
                          flexShrink: 0,
                          fontSize: 10,
                          fontWeight: 700,
                          '& .MuiChip-label': { px: 0.6 },
                        }}
                      />
                    </Tooltip>
                  );
                })()}
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
              <TableCell align="right">#</TableCell>
              <TableCell>Código</TableCell>
              <TableCell>
                <Tooltip title="Quanto o vídeo repete os que vêm antes dele nesta ordem. Postar dois ganchos iguais em sequência é o jeito mais rápido de o algoritmo tratar o segundo como repost.">
                  <span>Originalidade</span>
                </Tooltip>
              </TableCell>
              <TableCell>Arquivo</TableCell>
              <TableCell>Status</TableCell>
              <TableCell align="right">Vídeo</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {videos.map((v) => (
              <TableRow key={v.id} hover>
                <TableCell
                  align="right"
                  sx={{ color: 'text.secondary', fontVariantNumeric: 'tabular-nums' }}
                >
                  {v.postOrder || '—'}
                </TableCell>
                <TableCell>
                  <CodigoChip code={v.code} />
                </TableCell>
                <TableCell>
                  <OriginalidadeChip originality={v.originality} />
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
 * Qual peça está vendendo, segundo os resultados que o vendedor lançou.
 *
 * Só aparece com pelo menos DOIS vídeos lançados: com um só, "o gancho 1 é o
 * melhor" seria verdade trivial e daria ao vendedor uma confiança que o dado
 * não sustenta. Sem dado nenhum, o componente não desenha nada — quem não usa
 * o lançamento não vê um painel vazio ocupando a tela.
 *
 * Busca por grupo e só quando aberto: a galeria pode ter dezenas de produtos e
 * carregar o ranking de todos no `mount` seria uma rajada de requisições para
 * painéis que ninguém pediu.
 */
function RankingDePecas({
  planId,
  videos,
  podeDerivar,
  onDerivado,
}: {
  planId: string;
  videos: CombinationVideo[];
  /** `false` quando o plano foi apagado: sem plano não há o que derivar. */
  podeDerivar: boolean;
  onDerivado: () => void;
}) {
  const [dados, setDados] = useState<PlanoInsights | null>(null);
  const [derivando, setDerivando] = useState(false);
  const [erroDerivar, setErroDerivar] = useState<string | null>(null);
  const [derivado, setDerivado] = useState<string | null>(null);
  const lancados = videos.filter((v) => v.views !== null || v.sales !== null).length;

  useEffect(() => {
    if (lancados < 2) {
      setDados(null);
      return;
    }
    let vivo = true;
    combinationsService
      .insights(planId)
      .then((r) => vivo && setDados(r))
      .catch(console.error);
    return () => {
      vivo = false;
    };
  }, [planId, lancados]);

  if (!dados || lancados < 2) return null;

  const ganchos = dados.blocos.hook.filter((p) => p.mediaViews !== null);
  if (ganchos.length < 2) return null;

  const melhor = ganchos[0];
  const media = dados.mediaGeralViews ?? 0;
  const vezes = media > 0 && melhor.mediaViews ? melhor.mediaViews / media : null;

  /*
   * Derivar só faz sentido quando existe uma poda defensável: pelo menos duas
   * peças com dado firme para escolher entre elas. Com menos que isso o botão
   * criaria um plano idêntico ao atual e cobraria do vendedor a montagem de
   * novo — atalho que só parece um atalho.
   */
  const podamos = ganchos.filter((p) => !p.dadoFraco).length >= 2;

  async function derivar() {
    setDerivando(true);
    setErroDerivar(null);
    try {
      const novo = await combinationsService.derive(planId);
      setDerivado(novo.sigla);
      onDerivado();
    } catch (err) {
      setErroDerivar(
        err instanceof Error
          ? err.message
          : 'Não foi possível criar o plano derivado.',
      );
    } finally {
      setDerivando(false);
    }
  }

  return (
    <Box sx={{ px: 1.5, pb: 1.5 }}>
      <Box
        sx={{
          p: 1.5,
          borderRadius: 2,
          bgcolor: 'action.hover',
          border: '1px solid',
          borderColor: 'divider',
        }}
      >
        <Typography variant="caption" color="text.secondary" display="block" mb={1}>
          Segundo os {dados.videosLancados} resultados lançados — o gancho é o
          bloco que decide o scroll, então é por ele que o ranking começa.
        </Typography>
        <Stack spacing={0.75}>
          {ganchos.map((peca) => (
            <Stack
              key={peca.codigo}
              direction="row"
              alignItems="center"
              spacing={1}
              useFlexGap
              sx={{ flexWrap: 'wrap', rowGap: 0.25 }}
            >
              <Box
                sx={{
                  px: 0.6,
                  py: 0.2,
                  borderRadius: 0.75,
                  fontSize: 11,
                  fontWeight: 700,
                  fontFamily: 'monospace',
                  color: BLOCOS[0].texto,
                  bgcolor: BLOCOS[0].cor,
                }}
              >
                {peca.codigo}
              </Box>
              <Typography variant="body2" noWrap sx={{ flexGrow: 1, minWidth: 0 }}>
                {peca.rotulo}
              </Typography>
              <Typography variant="body2" fontWeight={700}>
                {compacto(peca.mediaViews ?? 0)}
              </Typography>
              <Typography variant="caption" color="text.secondary">
                média · {peca.videos} {plural(peca.videos, 'vídeo', 'vídeos')}
              </Typography>
              {/* Sem esta marca a média de 1 vídeo senta no topo com a mesma
                  cara de quem venceu 15 vezes — e é o topo que o vendedor usa
                  para decidir o que gravar de novo. */}
              {peca.dadoFraco && (
                <Tooltip
                  title={`Média de poucos vídeos. A partir de ${dados.minimoConfiavel} lançados o número fica confiável.`}
                >
                  <Chip
                    size="small"
                    variant="outlined"
                    color="warning"
                    label="dado fraco"
                    sx={{ height: 18, fontSize: 10 }}
                  />
                </Tooltip>
              )}
            </Stack>
          ))}
        </Stack>
        {vezes && vezes >= 1.2 && !melhor.dadoFraco && (
          <Typography variant="caption" color="success.main" display="block" mt={1}>
            {melhor.codigo} está {vezes.toFixed(1).replace('.', ',')}× acima da
            média do produto — grave mais variações dele.
          </Typography>
        )}

        {/* O ranking sem esta saída termina num beco: o vendedor descobre a
            peça campeã e não tem o que fazer com a descoberta além de remontar
            tudo de memória. */}
        {podeDerivar && podamos && !derivado && (
          <Button
            size="small"
            fullWidth
            variant="outlined"
            startIcon={
              derivando ? (
                <CircularProgress size={14} color="inherit" />
              ) : (
                <DynamicFeedRoundedIcon />
              )
            }
            disabled={derivando}
            onClick={() => void derivar()}
            sx={{ mt: 1.5 }}
          >
            {derivando ? 'Criando…' : 'Criar plano só com as campeãs'}
          </Button>
        )}
        {derivado && (
          <Alert severity="success" sx={{ mt: 1.5 }}>
            Plano <strong>{derivado}</strong> criado com as peças que melhor
            performaram. Ele está na lista de planos, pronto para montar.
          </Alert>
        )}
        {erroDerivar && (
          <Alert severity="error" sx={{ mt: 1.5 }}>
            {erroDerivar}
          </Alert>
        )}
      </Box>
    </Box>
  );
}

/**
 * Lançamento do desempenho de um vídeo.
 *
 * Os campos nascem com o que já foi lançado e aceitam ficar vazios: apagar o
 * número e salvar manda `null`, que é como o vendedor desfaz um valor digitado
 * errado. Nenhum campo é obrigatório — dá para lançar só views, só vendas, ou
 * só o link.
 */
function DialogDeResultado({
  video,
  onFechar,
  onSalvo,
  onErro,
}: {
  video: CombinationVideo | null;
  onFechar: () => void;
  onSalvo: () => void;
  onErro: (mensagem: string) => void;
}) {
  const [views, setViews] = useState('');
  const [vendas, setVendas] = useState('');
  const [link, setLink] = useState('');
  const [salvando, setSalvando] = useState(false);

  // Recarrega os campos a cada vídeo aberto — sem isto o diálogo mostraria os
  // números do vídeo anterior.
  useEffect(() => {
    setViews(video?.views !== null && video ? String(video.views) : '');
    setVendas(video?.sales !== null && video ? String(video.sales) : '');
    setLink(video?.postUrl ?? '');
  }, [video]);

  if (!video) return null;

  const numeroOuNulo = (texto: string) =>
    texto.trim() === '' ? null : Math.max(Math.trunc(Number(texto)), 0);

  async function salvar() {
    if (!video) return;
    setSalvando(true);
    try {
      await combinationsService.setResult(video.id, {
        views: numeroOuNulo(views),
        sales: numeroOuNulo(vendas),
        postUrl: link.trim() === '' ? null : link.trim(),
      });
      onSalvo();
    } catch (err) {
      onErro(
        mensagemDeErro(err, 'Não foi possível salvar o resultado.'),
      );
    } finally {
      setSalvando(false);
    }
  }

  return (
    <Dialog open onClose={onFechar} fullWidth maxWidth="xs">
      <DialogTitle>Resultado do vídeo</DialogTitle>
      <DialogContent>
        <Typography
          variant="caption"
          color="text.secondary"
          display="block"
          sx={{ mb: 2, fontFamily: 'monospace' }}
        >
          {video.filename}
        </Typography>
        <Stack spacing={2}>
          <TextField
            autoFocus
            size="small"
            type="number"
            label="Views"
            placeholder="deixe vazio se não quiser lançar"
            value={views}
            inputProps={{ min: 0 }}
            onChange={(e) => setViews(e.target.value)}
          />
          <TextField
            size="small"
            type="number"
            label="Vendas (opcional)"
            value={vendas}
            inputProps={{ min: 0 }}
            onChange={(e) => setVendas(e.target.value)}
          />
          <TextField
            size="small"
            label="Link do post (opcional)"
            placeholder="https://www.tiktok.com/@..."
            value={link}
            onChange={(e) => setLink(e.target.value)}
          />
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onFechar}>Cancelar</Button>
        <Button variant="contained" disabled={salvando} onClick={() => void salvar()}>
          {salvando ? 'Salvando…' : 'Salvar'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

/**
 * Lançamento de todos os vídeos de um produto numa tela só.
 *
 * O diálogo de um vídeo por vez é correto e inútil na escala real: com 150
 * arquivos, lançar resultado custava 150 aberturas, e o resultado prático era
 * que ninguém lançava — o que deixava o ranking de peças, que é a única coisa
 * aqui que a concorrência não copia, permanentemente vazio.
 *
 * A ordem é a de postagem, a mesma da galeria: o vendedor desce a lista do
 * TikTok num monitor e a planilha aqui no outro, na mesma sequência.
 *
 * Só o que MUDOU é enviado. Sem isso, abrir e salvar sem digitar nada
 * reescreveria as 150 linhas — e um campo esvaziado por acidente apagaria um
 * número que o vendedor tinha lançado semanas antes.
 */
function DialogDeLancamentoEmMassa({
  grupo,
  onFechar,
  onSalvo,
  onErro,
}: {
  grupo: GaleriaGrupo | null;
  onFechar: () => void;
  onSalvo: () => void;
  onErro: (mensagem: string) => void;
}) {
  const [campos, setCampos] = useState<
    Record<string, { views: string; sales: string }>
  >({});
  const [salvando, setSalvando] = useState(false);
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('sm'));

  // Recarrega ao trocar de produto: sem isto a planilha abriria com os números
  // do produto anterior por baixo dos campos vazios.
  useEffect(() => {
    const inicial: Record<string, { views: string; sales: string }> = {};
    for (const v of grupo?.videos ?? []) {
      inicial[v.id] = {
        views: v.views === null ? '' : String(v.views),
        sales: v.sales === null ? '' : String(v.sales),
      };
    }
    setCampos(inicial);
  }, [grupo]);

  if (!grupo) return null;

  const numeroOuNulo = (texto: string) =>
    texto.trim() === '' ? null : Math.max(Math.trunc(Number(texto)), 0);

  const original = (v: CombinationVideo) => ({
    views: v.views === null ? '' : String(v.views),
    sales: v.sales === null ? '' : String(v.sales),
  });

  const alterados = grupo.videos.filter((v) => {
    const atual = campos[v.id];
    if (!atual) return false;
    const antes = original(v);
    return atual.views !== antes.views || atual.sales !== antes.sales;
  });

  async function salvar() {
    if (!alterados.length) {
      onFechar();
      return;
    }
    setSalvando(true);
    try {
      await combinationsService.setResults(
        alterados.map((v) => ({
          id: v.id,
          views: numeroOuNulo(campos[v.id].views),
          sales: numeroOuNulo(campos[v.id].sales),
        })),
      );
      onSalvo();
    } catch (err) {
      onErro(
        err instanceof Error
          ? err.message
          : 'Não foi possível salvar os resultados.',
      );
    } finally {
      setSalvando(false);
    }
  }

  return (
    <Dialog open onClose={onFechar} fullWidth maxWidth="sm" fullScreen={isMobile}>
      <DialogTitle>Lançar resultados · {grupo.sigla}</DialogTitle>
      <DialogContent dividers>
        <Typography variant="caption" color="text.secondary" display="block" mb={1.5}>
          Na ordem de postagem. Deixe vazio o que ainda não tem número — só o
          que você mudar é enviado.
        </Typography>
        <Stack spacing={0.75}>
          {grupo.videos.map((v) => (
            <Stack key={v.id} direction="row" spacing={1} alignItems="center">
              <Box
                sx={{
                  px: 0.6,
                  py: 0.2,
                  borderRadius: 0.75,
                  fontSize: 11,
                  fontWeight: 700,
                  fontFamily: 'monospace',
                  bgcolor: 'action.hover',
                  minWidth: 62,
                  textAlign: 'center',
                  flexShrink: 0,
                }}
              >
                {v.code}
              </Box>
              <TextField
                size="small"
                type="number"
                label="Views"
                value={campos[v.id]?.views ?? ''}
                inputProps={{ min: 0 }}
                onChange={(e) =>
                  setCampos((prev) => ({
                    ...prev,
                    [v.id]: { ...prev[v.id], views: e.target.value },
                  }))
                }
                sx={{ flexGrow: 1, minWidth: 0 }}
              />
              <TextField
                size="small"
                type="number"
                label="Vendas"
                value={campos[v.id]?.sales ?? ''}
                inputProps={{ min: 0 }}
                onChange={(e) =>
                  setCampos((prev) => ({
                    ...prev,
                    [v.id]: { ...prev[v.id], sales: e.target.value },
                  }))
                }
                sx={{ width: { xs: 88, sm: 110 }, flexShrink: 0 }}
              />
            </Stack>
          ))}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onFechar}>Cancelar</Button>
        <Button
          variant="contained"
          disabled={salvando || !alterados.length}
          onClick={() => void salvar()}
        >
          {salvando
            ? 'Salvando…'
            : alterados.length
              ? `Salvar ${alterados.length} ${plural(alterados.length, 'vídeo', 'vídeos')}`
              : 'Nada mudou'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

/** 12.400 → "12,4k". Números crus de views ocupam o card inteiro. */
function compacto(n: number): string {
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${(n / 1000).toFixed(1).replace('.0', '').replace('.', ',')}k`;
  return `${(n / 1_000_000).toFixed(1).replace('.0', '').replace('.', ',')}M`;
}

/**
 * O desempenho do vídeo, ou o convite para lançá-lo.
 *
 * Lançar resultado é OPCIONAL e nada no Multiplicador depende disso, então
 * quem não usa não pode ser incomodado: sem número, é só um link apagado no
 * rodapé do card — não um campo vazio pedindo preenchimento, não um aviso.
 */
function ResultadoDoVideo({
  video,
  onLancar,
}: {
  video: CombinationVideo;
  onLancar: (video: CombinationVideo) => void;
}) {
  const temDados = video.views !== null || video.sales !== null;
  return (
    <Box
      component="button"
      type="button"
      onClick={() => onLancar(video)}
      sx={{
        border: 0,
        bgcolor: 'transparent',
        p: 0,
        mt: 0.5,
        cursor: 'pointer',
        font: 'inherit',
        fontSize: 11,
        display: 'block',
        color: temDados ? 'text.primary' : 'text.disabled',
        '&:hover': { color: 'primary.main' },
      }}
    >
      {temDados
        ? [
            video.views !== null ? `${compacto(video.views)} views` : null,
            video.sales !== null ? `${video.sales} vendas` : null,
          ]
            .filter(Boolean)
            .join(' · ')
        : '+ resultado'}
    </Box>
  );
}

/** Cor da etiqueta: verde no que é inédito, âmbar no meio, cinza no repetido. */
const COR_ORIGINALIDADE: Record<
  CombinationOriginality,
  'success' | 'warning' | 'default'
> = {
  original: 'success',
  parecido: 'warning',
  'muito-parecido': 'default',
};

/**
 * Etiqueta de originalidade.
 *
 * Vídeos antigos, montados antes desta feature, vêm sem etiqueta do banco —
 * mostrar "Original" neles seria mentira, então a célula fica vazia.
 */
function OriginalidadeChip({
  originality,
}: {
  originality: CombinationOriginality | null | undefined;
}) {
  if (!originality || !ORIGINALITY_LABEL[originality]) {
    return (
      <Typography variant="caption" color="text.disabled">
        —
      </Typography>
    );
  }
  return (
    <Tooltip title={ORIGINALITY_HINT[originality]}>
      <Chip
        size="small"
        variant="outlined"
        color={COR_ORIGINALIDADE[originality]}
        label={ORIGINALITY_LABEL[originality]}
        sx={{ fontWeight: 600 }}
      />
    </Tooltip>
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
    <Stack direction="row" spacing={0.25} useFlexGap sx={{ flexWrap: 'wrap' }}>
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
              color: bloco?.texto ?? '#fff',
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
/**
 * Velocidades de revisão.
 *
 * Conferir dezenas de vídeos que só diferem em um pedaço é trabalho de
 * varredura, não de assistir: em 2x dá para ver se o corte ficou certo em
 * metade do tempo. O 0.5x existe para o caso oposto — checar quadro a quadro
 * a emenda entre gancho e corpo, que é onde a montagem falha.
 */
const VELOCIDADES = [0.5, 1, 1.5, 2] as const;

/** Quantos segundos os botões de pular avançam/voltam. */
const PULO_SEGUNDOS = 5;

/**
 * Prévia que assume o formato do próprio arquivo.
 *
 * O card era fixo em 9:16, então um plano montado em 16:9 ou 1:1 aparecia
 * espremido no meio de duas tarjas pretas — parecia defeito da montagem,
 * quando o MP4 estava certo. A proporção real só é conhecida depois que o
 * cabeçalho carrega, então começa no vertical (o formato mais comum) e se
 * ajusta quando os metadados chegam.
 */
function PreviaDoVideo({ url }: { url: string }) {
  const [proporcao, setProporcao] = useState('9 / 16');
  const [velocidade, setVelocidade] = useState(1);
  const videoRef = useRef<HTMLVideoElement | null>(null);

  // `playbackRate` volta para 1 sempre que o elemento recarrega a fonte, então
  // é reaplicado no `loadedmetadata` além do clique.
  function aplicarVelocidade(taxa: number) {
    setVelocidade(taxa);
    if (videoRef.current) videoRef.current.playbackRate = taxa;
  }

  function pular(segundos: number) {
    const video = videoRef.current;
    if (!video) return;
    const destino = video.currentTime + segundos;
    // `duration` é NaN enquanto os metadados não chegam; sem o guarda o seek
    // vira NaN e o player trava no primeiro quadro.
    const limite = Number.isFinite(video.duration) ? video.duration : destino;
    video.currentTime = Math.min(Math.max(destino, 0), limite);
  }

  return (
    <Box>
      <Box
        component="video"
        ref={videoRef}
        src={url}
        controls
        preload="metadata"
        onLoadedMetadata={(e: SyntheticEvent<HTMLVideoElement>) => {
          const { videoWidth: l, videoHeight: a } = e.currentTarget;
          if (l && a) setProporcao(`${l} / ${a}`);
          e.currentTarget.playbackRate = velocidade;
        }}
        sx={{
          width: '100%',
          aspectRatio: proporcao,
          display: 'block',
          objectFit: 'contain',
          bgcolor: '#000',
        }}
      />
      <Stack
        direction="row"
        alignItems="center"
        spacing={0.5}
        sx={{ px: 0.75, py: 0.5, bgcolor: '#000', flexWrap: 'wrap', rowGap: 0.5 }}
      >
        <Tooltip title={`Voltar ${PULO_SEGUNDOS}s`}>
          <IconButton
            size="small"
            onClick={() => pular(-PULO_SEGUNDOS)}
            sx={{ color: 'grey.400' }}
          >
            <Replay5RoundedIcon fontSize="small" />
          </IconButton>
        </Tooltip>
        <Tooltip title={`Avançar ${PULO_SEGUNDOS}s`}>
          <IconButton
            size="small"
            onClick={() => pular(PULO_SEGUNDOS)}
            sx={{ color: 'grey.400' }}
          >
            <Forward5RoundedIcon fontSize="small" />
          </IconButton>
        </Tooltip>
        <Box sx={{ flexGrow: 1 }} />
        {VELOCIDADES.map((taxa) => (
          <Box
            key={taxa}
            component="button"
            type="button"
            onClick={() => aplicarVelocidade(taxa)}
            sx={{
              border: 0,
              cursor: 'pointer',
              px: 0.75,
              py: 0.25,
              borderRadius: 1,
              fontSize: 11,
              fontWeight: 700,
              fontFamily: 'inherit',
              color: taxa === velocidade ? '#000' : 'grey.400',
              bgcolor: taxa === velocidade ? 'primary.main' : 'transparent',
            }}
          >
            {taxa}x
          </Box>
        ))}
      </Stack>
    </Box>
  );
}

function Galeria({
  grupos,
  onRecarregar,
}: {
  grupos: GaleriaGrupo[];
  onRecarregar: () => void;
}) {
  // Ids já removidos da tela mas ainda em voo no servidor: some na hora, sem
  // esperar o round-trip, e volta se a chamada falhar.
  const [descartados, setDescartados] = useState<string[]>([]);
  const [erroDescarte, setErroDescarte] = useState<string | null>(null);
  const [busca, setBusca] = useState('');
  /**
   * Duas leituras da mesma galeria.
   *
   * "Produto" responde de qual matriz o arquivo saiu — um fato do sistema.
   * "Pasta" responde o que o vendedor decidiu fazer com ele. Nenhuma das duas
   * substitui a outra, então a tela deixa alternar em vez de escolher por ele.
   */
  const [visao, setVisao] = useState<'produto' | 'pasta'>('produto');
  const [pastas, setPastas] = useState<CombinationFolder[]>([]);
  const [movendo, setMovendo] = useState<CombinationVideo | null>(null);
  const [ancoraMenu, setAncoraMenu] = useState<HTMLElement | null>(null);
  const [criandoPasta, setCriandoPasta] = useState(false);
  const [nomeDaPasta, setNomeDaPasta] = useState('');
  const [corDaPasta, setCorDaPasta] = useState(CORES_DE_PASTA[0]);
  const [pastaParaApagar, setPastaParaApagar] = useState<GaleriaGrupo | null>(null);
  const [lancando, setLancando] = useState<CombinationVideo | null>(null);
  /** Produto com a planilha de lançamento aberta. */
  const [lancandoGrupo, setLancandoGrupo] = useState<GaleriaGrupo | null>(null);

  const recarregarPastas = useCallback(() => {
    combinationsService.listFolders().then(setPastas).catch(console.error);
  }, []);

  useEffect(() => recarregarPastas(), [recarregarPastas]);

  const termo = busca.trim().toLowerCase();
  // A busca casa com a sigla do produto OU com o nome do arquivo: o vendedor
  // às vezes procura "cinta", às vezes cola o nome do MP4 que já postou.
  // `videos` vem do backend, e um backend mais antigo que esta tela devolve a
  // galeria como lista plana de vídeos, sem o grupo em volta. Sem esta guarda o
  // `.filter` estoura no primeiro item e a tela inteira fica branca — uma
  // divergência de versão tem que degradar para galeria vazia, não para crash.
  const gruposVisiveis = (Array.isArray(grupos) ? grupos : [])
    .filter((grupo) => Array.isArray(grupo?.videos))
    .map((grupo) => ({
      ...grupo,
      videos: grupo.videos.filter(
        (v) =>
          v.status === 'pronto' &&
          v.url &&
          !descartados.includes(v.id) &&
          (!termo ||
            grupo.sigla.toLowerCase().includes(termo) ||
            v.filename.toLowerCase().includes(termo)),
      ),
    }))
    .filter((grupo) => grupo.videos.length > 0);

  const totalVisivel = gruposVisiveis.reduce((s, g) => s + g.videos.length, 0);

  /**
   * Os mesmos vídeos, reagrupados por pasta.
   *
   * "Sem pasta" vai por último de propósito: é a caixa de entrada, e o que
   * interessa ver primeiro são as pastas que o vendedor montou.
   */
  const gruposPorPasta: GaleriaGrupo[] = (() => {
    const todos = gruposVisiveis.flatMap((g) => g.videos);
    const porPasta = new Map<string, CombinationVideo[]>();
    for (const v of todos) {
      const chave = v.folderId ?? SEM_PASTA;
      const lista = porPasta.get(chave) ?? [];
      lista.push(v);
      porPasta.set(chave, lista);
    }
    const grupos: GaleriaGrupo[] = [];
    for (const pasta of pastas) {
      const videos = porPasta.get(pasta.id);
      // Pasta vazia continua listada: é onde o vendedor vai soltar o próximo
      // vídeo, e sumir da tela faria parecer que ela foi apagada.
      grupos.push({
        planId: pasta.id,
        sigla: pasta.name,
        format: null,
        planoExiste: true,
        cor: pasta.color,
        atualizadoEm: pasta.createdAt,
        videos: videos ?? [],
      });
    }
    const soltos = porPasta.get(SEM_PASTA);
    if (soltos?.length) {
      grupos.push({
        planId: SEM_PASTA,
        sigla: 'Sem pasta',
        format: null,
        planoExiste: true,
        atualizadoEm: '',
        videos: soltos,
      });
    }
    return grupos;
  })();

  const exibidos = visao === 'pasta' ? gruposPorPasta : gruposVisiveis;

  async function handleMover(video: CombinationVideo, folderId: string | null) {
    setAncoraMenu(null);
    setMovendo(null);
    try {
      await combinationsService.moveVideos([video.id], folderId);
      onRecarregar();
    } catch (err) {
      setErroDescarte(
        mensagemDeErro(err, 'Não foi possível mover o vídeo.'),
      );
    }
  }

  async function handleCriarPasta() {
    const nome = nomeDaPasta.trim();
    if (!nome) return;
    try {
      await combinationsService.createFolder(nome, corDaPasta);
      setNomeDaPasta('');
      setCriandoPasta(false);
      recarregarPastas();
      setVisao('pasta');
    } catch (err) {
      setErroDescarte(
        mensagemDeErro(err, 'Não foi possível criar a pasta.'),
      );
    }
  }

  async function handleApagarPasta(grupo: GaleriaGrupo) {
    try {
      await combinationsService.deleteFolder(grupo.planId);
      setPastaParaApagar(null);
      recarregarPastas();
      onRecarregar();
    } catch (err) {
      setErroDescarte(
        mensagemDeErro(err, 'Não foi possível apagar a pasta.'),
      );
    }
  }

  async function handleDescartar(video: CombinationVideo) {
    setErroDescarte(null);
    setDescartados((prev) => [...prev, video.id]);
    try {
      await combinationsService.deleteVideo(video.id);
      onRecarregar();
    } catch (err) {
      setDescartados((prev) => prev.filter((id) => id !== video.id));
      setErroDescarte(
        mensagemDeErro(err, 'Não foi possível descartar o vídeo.'),
      );
    }
  }

  return (
    <Card>
      <CardContent>
        <Stack
          direction="row"
          alignItems="center"
          spacing={1}
          sx={{ mb: 2, flexWrap: 'wrap', rowGap: 1 }}
        >
          <Box sx={{ flexGrow: 1, minWidth: { xs: '100%', sm: 220 } }}>
            <Typography variant="h6">Meus vídeos</Typography>
            <Typography variant="caption" color="text.secondary">
              {totalVisivel
                ? `${totalVisivel} ${plural(totalVisivel, 'vídeo', 'vídeos')} em ${gruposVisiveis.length} ${plural(gruposVisiveis.length, 'produto', 'produtos')} — na ordem de postagem`
                : 'Os vídeos que você montar ficam guardados aqui, agrupados por produto'}
            </Typography>
          </Box>
          <ToggleButtonGroup
            size="small"
            exclusive
            value={visao}
            onChange={(_e, v) => v && setVisao(v)}
            sx={{ '& .MuiToggleButton-root': { textTransform: 'none', px: 1.5 } }}
          >
            <ToggleButton value="produto">Por produto</ToggleButton>
            <ToggleButton value="pasta">Por pasta</ToggleButton>
          </ToggleButtonGroup>
          <Button size="small" onClick={() => setCriandoPasta(true)}>
            Nova pasta
          </Button>
          <TextField
            size="small"
            placeholder="Buscar produto ou arquivo…"
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            sx={{
              width: { xs: '100%', sm: 220 },
              '& .MuiOutlinedInput-root': { borderRadius: 2.5 },
            }}
          />
          <Button size="small" onClick={onRecarregar}>
            Atualizar
          </Button>
        </Stack>

        {erroDescarte && (
          <Alert severity="error" sx={{ mb: 1.5 }} onClose={() => setErroDescarte(null)}>
            {erroDescarte}
          </Alert>
        )}

        {exibidos.length === 0 ? (
          <Typography variant="body2" color="text.secondary">
            {busca
              ? `Nenhum produto ou arquivo com “${busca}”.`
              : 'Nenhum vídeo montado ainda. Gere uma matriz e clique em “Montar vídeos”.'}
          </Typography>
        ) : (
          <Stack spacing={1.5}>
            {exibidos.map((grupo) => (
              <GrupoDeProduto
                key={grupo.planId}
                grupo={grupo}
                // Um grupo só: já abre aberto, porque não há o que escolher.
                abertoPorPadrao={exibidos.length === 1}
                podeApagar={visao === 'pasta' && grupo.planId !== SEM_PASTA}
                onApagarPasta={() => setPastaParaApagar(grupo)}
                onDescartar={handleDescartar}
                onMover={(video, alvo) => {
                  setMovendo(video);
                  setAncoraMenu(alvo);
                }}
                onLancarResultado={setLancando}
                onLancarTudo={() => setLancandoGrupo(grupo)}
                onDerivado={onRecarregar}
              />
            ))}
          </Stack>
        )}

        <Menu
          open={Boolean(ancoraMenu && movendo)}
          anchorEl={ancoraMenu}
          onClose={() => {
            setAncoraMenu(null);
            setMovendo(null);
          }}
        >
          {pastas.map((pasta) => (
            <MenuItem
              key={pasta.id}
              selected={movendo?.folderId === pasta.id}
              onClick={() => void handleMover(movendo!, pasta.id)}
            >
              <Box
                sx={{
                  width: 10,
                  height: 10,
                  borderRadius: '50%',
                  bgcolor: pasta.color,
                  mr: 1,
                }}
              />
              {pasta.name}
            </MenuItem>
          ))}
          {movendo?.folderId && (
            <MenuItem onClick={() => void handleMover(movendo, null)}>
              Tirar da pasta
            </MenuItem>
          )}
          {pastas.length === 0 && (
            <MenuItem
              onClick={() => {
                setAncoraMenu(null);
                setCriandoPasta(true);
              }}
            >
              Criar a primeira pasta…
            </MenuItem>
          )}
        </Menu>

        <Dialog
          open={criandoPasta}
          onClose={() => setCriandoPasta(false)}
          fullWidth
          maxWidth="xs"
        >
          <DialogTitle>Nova pasta</DialogTitle>
          <DialogContent>
            <TextField
              autoFocus
              fullWidth
              margin="dense"
              label="Nome"
              placeholder="Ex.: Postar essa semana"
              value={nomeDaPasta}
              inputProps={{ maxLength: 60 }}
              onChange={(e) => setNomeDaPasta(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && void handleCriarPasta()}
            />
            <Stack direction="row" spacing={1} sx={{ mt: 2 }}>
              {CORES_DE_PASTA.map((cor) => (
                <Box
                  key={cor}
                  component="button"
                  type="button"
                  aria-label={`Cor ${cor}`}
                  onClick={() => setCorDaPasta(cor)}
                  sx={{
                    width: 26,
                    height: 26,
                    borderRadius: '50%',
                    bgcolor: cor,
                    cursor: 'pointer',
                    border: '2px solid',
                    borderColor: cor === corDaPasta ? 'text.primary' : 'transparent',
                  }}
                />
              ))}
            </Stack>
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setCriandoPasta(false)}>Cancelar</Button>
            <Button
              variant="contained"
              disabled={!nomeDaPasta.trim()}
              onClick={() => void handleCriarPasta()}
            >
              Criar
            </Button>
          </DialogActions>
        </Dialog>

        <DialogDeResultado
          video={lancando}
          onFechar={() => setLancando(null)}
          onSalvo={() => {
            setLancando(null);
            onRecarregar();
          }}
          onErro={setErroDescarte}
        />

        <DialogDeLancamentoEmMassa
          grupo={lancandoGrupo}
          onFechar={() => setLancandoGrupo(null)}
          onSalvo={() => {
            setLancandoGrupo(null);
            onRecarregar();
          }}
          onErro={setErroDescarte}
        />

        <Dialog open={Boolean(pastaParaApagar)} onClose={() => setPastaParaApagar(null)}>
          <DialogTitle>Apagar “{pastaParaApagar?.sigla}”?</DialogTitle>
          <DialogContent>
            <Typography variant="body2" color="text.secondary">
              Os {pastaParaApagar?.videos.length ?? 0} vídeo(s) voltam para “Sem
              pasta”. Nenhum arquivo é removido.
            </Typography>
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setPastaParaApagar(null)}>Cancelar</Button>
            <Button
              color="error"
              variant="contained"
              onClick={() => void handleApagarPasta(pastaParaApagar!)}
            >
              Apagar pasta
            </Button>
          </DialogActions>
        </Dialog>
      </CardContent>
    </Card>
  );
}

/**
 * Os vídeos de um produto, recolhíveis.
 *
 * Nasce fechado quando há vários produtos: abrir todos de uma vez traria
 * dezenas de `<video>` para a tela e a aba levaria segundos para responder,
 * mesmo com `preload="metadata"`.
 */
function GrupoDeProduto({
  grupo,
  abertoPorPadrao,
  podeApagar,
  onApagarPasta,
  onDescartar,
  onMover,
  onLancarResultado,
  onLancarTudo,
  onDerivado,
}: {
  grupo: GaleriaGrupo;
  abertoPorPadrao: boolean;
  podeApagar: boolean;
  onApagarPasta: () => void;
  onDescartar: (video: CombinationVideo) => void;
  onMover: (video: CombinationVideo, alvo: HTMLElement) => void;
  onLancarResultado: (video: CombinationVideo) => void;
  onLancarTudo: () => void;
  onDerivado: () => void;
}) {
  const [aberto, setAberto] = useState(abertoPorPadrao);
  const originais = grupo.videos.filter((v) => v.originality === 'original');

  return (
    <Box sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 2 }}>
      <Stack
        direction="row"
        alignItems="center"
        spacing={1}
        onClick={() => setAberto((v) => !v)}
        sx={{
          p: 1.5,
          cursor: 'pointer',
          userSelect: 'none',
          flexWrap: 'wrap',
          rowGap: 0.5,
        }}
      >
        {grupo.cor && (
          <Box
            sx={{
              width: 10,
              height: 10,
              borderRadius: '50%',
              bgcolor: grupo.cor,
              flexShrink: 0,
            }}
          />
        )}
        <Typography sx={{ fontWeight: 700, wordBreak: 'break-word' }}>
          {grupo.sigla}
        </Typography>
        {grupo.format && (
          <Chip size="small" variant="outlined" label={grupo.format} />
        )}
        <Typography variant="caption" color="text.secondary">
          {grupo.videos.length} {plural(grupo.videos.length, 'vídeo', 'vídeos')}
          {originais.length ? ` · ${originais.length} com gancho inédito` : ''}
        </Typography>
        {!grupo.planoExiste && (
          <Tooltip title="O plano foi apagado, mas os vídeos continuam guardados. Não dá para remontar sem criar a matriz de novo.">
            <Chip size="small" variant="outlined" color="warning" label="sem plano" />
          </Tooltip>
        )}
        <Box sx={{ flexGrow: 1 }} />
        {/* O atalho para a planilha fica no cabeçalho do produto porque é por
            produto que o vendedor lança: ele abre o TikTok, vê os números da
            campanha da cinta e quer digitar os dez de uma vez. */}
        {grupo.videos.length > 1 && (
          <Tooltip title="Lançar views e vendas de todos os vídeos deste produto">
            <Button
              size="small"
              variant="outlined"
              startIcon={<InsightsRoundedIcon />}
              onClick={(e) => {
                e.stopPropagation();
                onLancarTudo();
              }}
              sx={{ flexShrink: 0 }}
            >
              Lançar resultados
            </Button>
          </Tooltip>
        )}
        {podeApagar && (
          <Tooltip title="Apagar a pasta — os vídeos voltam para “Sem pasta”">
            <IconButton
              size="small"
              onClick={(e) => {
                e.stopPropagation();
                onApagarPasta();
              }}
              sx={{ color: 'text.disabled', '&:hover': { color: 'error.main' } }}
            >
              <DeleteOutlineRoundedIcon fontSize="small" />
            </IconButton>
          </Tooltip>
        )}
        <IconButton size="small">
          {aberto ? <ExpandLessRoundedIcon /> : <ExpandMoreRoundedIcon />}
        </IconButton>
      </Stack>

      {aberto && (
        <RankingDePecas
          planId={grupo.planId}
          videos={grupo.videos}
          podeDerivar={grupo.planoExiste}
          onDerivado={onDerivado}
        />
      )}

      {aberto && grupo.videos.length === 0 && (
        <Typography variant="body2" color="text.secondary" sx={{ px: 1.5, pb: 1.5 }}>
          Pasta vazia — use “Mover para” no canto de um vídeo para trazer algo
          para cá.
        </Typography>
      )}

      {aberto && grupo.videos.length > 0 && (
        <Box sx={{ p: 1.5, pt: 0 }}>
          <Grid container spacing={1.5}>
            {grupo.videos.map((v) => (
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
                  <PreviaDoVideo url={resolveApiUrl(v.url!)} />
                  <Box sx={{ p: 1, bgcolor: 'background.paper' }}>
                    <Stack
                      direction="row"
                      alignItems="center"
                      spacing={0.5}
                      mb={0.5}
                      useFlexGap
                      sx={{ flexWrap: 'wrap', rowGap: 0.25 }}
                    >
                      {/* A ordem de postagem é o dado mais útil aqui: diz por
                          qual desses arquivos começar. */}
                      <Typography
                        variant="caption"
                        color="text.secondary"
                        sx={{ fontVariantNumeric: 'tabular-nums' }}
                      >
                        {v.postOrder ? `#${v.postOrder}` : ''}
                      </Typography>
                      <CodigoChip code={v.code} />
                      <Box sx={{ flexGrow: 1 }} />
                      <Tooltip title="Mover para uma pasta">
                        <IconButton
                          size="small"
                          onClick={(e) => onMover(v, e.currentTarget)}
                          sx={{
                            color: v.folderId ? 'primary.main' : 'text.disabled',
                          }}
                        >
                          <FolderOutlinedIcon fontSize="small" />
                        </IconButton>
                      </Tooltip>
                      <Tooltip title="Descartar — apaga o arquivo. Remontar o plano recria este vídeo.">
                        <IconButton
                          size="small"
                          onClick={() => onDescartar(v)}
                          sx={{ color: 'text.disabled', '&:hover': { color: 'error.main' } }}
                        >
                          <DeleteOutlineRoundedIcon fontSize="small" />
                        </IconButton>
                      </Tooltip>
                    </Stack>
                    <OriginalidadeChip originality={v.originality} />
                    <ResultadoDoVideo video={v} onLancar={onLancarResultado} />
                    <Tooltip title={v.filename}>
                      <Typography
                        variant="caption"
                        noWrap
                        display="block"
                        sx={{ fontFamily: 'monospace', fontSize: 10, mt: 0.5 }}
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
        </Box>
      )}
    </Box>
  );
}

/** As quatro etapas do fluxo, na ordem em que acontecem. */
const ETAPAS = ['Produto', 'Clipes', 'Matriz', 'Vídeos'] as const;

/**
 * Entrada animada da etapa visível.
 *
 * As etapas alternam por `display`, e uma animação CSS reinicia sempre que o
 * elemento volta de `none` — então cada troca de etapa ganha um fade+slide sem
 * remontar componente nenhum (o que perderia uploads em andamento).
 */
const ENTRADA_DE_ETAPA = {
  '@keyframes etapaEntra': {
    from: { opacity: 0, transform: 'translateY(10px)' },
    to: { opacity: 1, transform: 'translateY(0)' },
  },
  animation: 'etapaEntra .3s ease',
  '@media (prefers-reduced-motion: reduce)': { animation: 'none' },
} as const;

/** A etapa da galeria — sempre alcançável, porque é só leitura. */
const ETAPA_VIDEOS = 3;

/** O que falta para poder seguir — some do caminho quando a etapa está ok. */
const DICA_DA_ETAPA = [
  'Dê uma sigla ao produto para continuar.',
  'Envie ao menos um gancho.',
  'Gere a matriz e clique em Montar vídeos.',
  'Seus vídeos, na ordem de postagem.',
];

export function MultiplierPage() {
  const { confirmar, dialogo } = useConfirmarGasto();
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('sm'));
  const [etapa, setEtapa] = useState(0);
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
  const [galeria, setGaleria] = useState<GaleriaGrupo[]>([]);
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

  /**
   * Clipes que o servidor vai recusar na montagem por serem longos demais.
   *
   * A tela precisa saber disso ANTES do clique em "Montar vídeos": o erro do
   * backend chega depois de o vendedor já ter planejado a matriz inteira em
   * cima de um gancho que não serve.
   */
  const clipesLongos = (['hook', 'body', 'cta'] as const).flatMap((role) =>
    doBloco(role).filter(
      (c) => situacaoDaDuracao(role, c.durationMs) === 'acima-do-limite',
    ),
  );

  /**
   * O requisito de cada etapa para liberar a seguinte.
   *
   * É o mesmo critério que o `Passo` já usava para marcar o check — mantê-lo
   * num lugar só evita a trilha dizer "concluído" enquanto o botão continua
   * desabilitado.
   */
  const custoEmCreditos = (result?.combinations.length ?? 0) * CREDITOS_POR_VIDEO;

  /*
   * Saldo contra o TOTAL da matriz, não contra o preço unitário.
   *
   * `useSaldo('assembly').insuficiente` compara com 1 crédito e nunca barraria
   * nada — a conta que importa aqui é a do lote inteiro. Conta ilimitada não
   * é barrada, e saldo ainda não carregado (`null`) também não: quem recusa de
   * verdade é o backend, e travar por falha de rede seria pior que o 402.
   */
  const { saldo: saldoAtual, ilimitado } = useSaldo('assembly');
  const saldoInsuficiente =
    !ilimitado &&
    saldoAtual !== null &&
    custoEmCreditos > 0 &&
    saldoAtual < custoEmCreditos;

  function etapaConcluida(indice: number): boolean {
    if (indice === 0) return Boolean(sigla.trim());
    if (indice === 1) return counts.hooks > 0;
    if (indice === 2) return Boolean(result);
    return true;
  }

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
        // A sigla do passo 1 etiqueta o clipe: é o que diz, na lista global,
        // qual produto aparece com o apresentador em cada vídeo.
        const clip = await combinationsService.uploadClip(role, arquivo, sigla);
        setClips((prev) => [...prev, clip]);
      }
    } catch (err) {
      setError(mensagemDeErro(err, 'Falha ao enviar o vídeo'));
    } finally {
      setEnviando(null);
    }
  }

  async function handleSetProduto(id: string, produto: string) {
    const atual = clips.find((c) => c.id === id);
    const nova = produto.trim() || null;
    if (!atual || atual.produto === nova) return;
    // Otimista: o chip muda na hora e volta se o servidor recusar.
    const anterior = clips;
    setClips((prev) => prev.map((c) => (c.id === id ? { ...c, produto: nova } : c)));
    try {
      await combinationsService.updateClip(id, produto.trim());
    } catch (err) {
      setClips(anterior);
      setError(mensagemDeErro(err, 'Falha ao etiquetar o clipe'));
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
      setError(mensagemDeErro(err, 'Falha ao remover o vídeo'));
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
      // A matriz é o resultado da etapa 3: sem isto o vendedor clicaria em
      // "Gerar" e continuaria olhando para o formulário que já resolveu.
      setEtapa(2);
    } catch (err) {
      setError(mensagemDeErro(err, 'Falha ao gerar combinações'));
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
    /*
     * A quantidade sai do plano, não do formulário.
     *
     * Montar a partir de "Planos salvos" não passa pela tela de montagem, e
     * `result` pode ser de outro plano — confirmar com o número errado seria
     * pior que não confirmar, porque o número parece conferido.
     */
    const doPlano =
      result?.id === planId
        ? (result?.combinations.length ?? 0)
        : ((await combinationsService.findOne(planId)).combinations.length ?? 0);
    const autorizado = await confirmar({
      acao: 'assembly',
      titulo: 'Montar os vídeos',
      quantidade: doPlano,
      detalhe: `${doPlano} ${plural(doPlano, 'vídeo', 'vídeos')} ${plural(
        doPlano,
        'será montado',
        'serão montados',
      )} a partir dos seus clipes.`,
    });
    if (!autorizado) return;
    setError(null);
    setMontando(true);
    // Montar já leva para a última etapa: é lá que o progresso e a galeria
    // aparecem, e é o que o vendedor quer ver enquanto a fila roda.
    setEtapa(3);
    try {
      // Montar direto de "Planos salvos" não passa pelo formulário, então
      // `result` estaria vazio e a etapa 4 mostraria o painel de "nenhum vídeo
      // ainda" enquanto a fila roda. Carrega o plano antes de acompanhar.
      if (result?.id !== planId) {
        setResult(await combinationsService.findOne(planId));
      }
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
      setError(mensagemDeErro(err, 'Falha ao montar os vídeos'));
      setMontando(false);
    }
  }

  async function handleCopy(combinations: Combination[]) {
    await navigator.clipboard.writeText(combinations.map((c) => c.filename).join('\n'));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  function handleDownloadCsv(plan: CombinationPlanDetail) {
    // A ordem das linhas já é a de postagem, e as duas primeiras colunas dizem
    // isso — a planilha vira o calendário de postagem, não só uma lista.
    const rows = [
      'ordem;originalidade;code;filename;hook;body;cta',
      ...plan.combinations.map((c) =>
        [
          c.postOrder,
          ORIGINALITY_LABEL[c.originality] ?? '',
          c.code,
          c.filename,
          c.hook,
          c.body,
          c.cta,
        ].join(';'),
      ),
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
              <TableCell align="right">#</TableCell>
              <TableCell>Código</TableCell>
              <TableCell>Originalidade</TableCell>
              <TableCell>Arquivo</TableCell>
              <TableCell>Gancho</TableCell>
              <TableCell>Corpo</TableCell>
              <TableCell>CTA</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {combinations.map((c) => (
              <TableRow key={c.code} hover>
                <TableCell
                  align="right"
                  sx={{ color: 'text.secondary', fontVariantNumeric: 'tabular-nums' }}
                >
                  {c.postOrder || '—'}
                </TableCell>
                <TableCell>
                  <CodigoChip code={c.code} />
                </TableCell>
                <TableCell>
                  <OriginalidadeChip originality={c.originality} />
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
    // Sem teto de largura: o resto do app cola nas margens do AppLayout, e um
    // container mais estreito aqui deixava faixas vazias dos dois lados.
    <Box>
      <Stack
        direction="row"
        spacing={1.75}
        alignItems="center"
        sx={{ mb: 3, flexWrap: 'wrap', rowGap: 1.5 }}
      >
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
          <DynamicFeedRoundedIcon />
        </Box>
        <Box sx={{ minWidth: 240, flex: 1 }}>
          <Typography variant="h5">Multiplicador de Vídeos</Typography>
          <Typography
            variant="body2"
            color="text.secondary"
            component="div"
            sx={{
              display: 'flex',
              alignItems: 'center',
              flexWrap: 'wrap',
              columnGap: 0.75,
              rowGap: 0.5,
            }}
          >
            A fórmula dos criativos vencedores:
            {BLOCOS.map((bloco, i) => (
              <Box
                key={bloco.role}
                component="span"
                sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.75 }}
              >
                {i > 0 && <Box component="span">+</Box>}
                {/* Pílula com fundo na cor do bloco: texto colorido direto no
                    branco (ciano, âmbar) não tem contraste — a mesma cor que
                    funciona como FUNDO nos cabeçalhos dos blocos. */}
                <Box
                  component="span"
                  sx={{
                    px: 0.9,
                    py: 0.1,
                    borderRadius: 1,
                    fontSize: 12,
                    fontWeight: 700,
                    color: bloco.texto,
                    bgcolor: bloco.cor,
                  }}
                >
                  {bloco.titulo.toUpperCase().replace(/S$/, '')}
                </Box>
              </Box>
            ))}
            <Box component="span">
              — suba seus clipes e a gente monta os vídeos prontos para postar.
            </Box>
          </Typography>
        </Box>
      </Stack>

      <form onSubmit={handleSubmit}>
        {/*
          O fluxo virou etapas porque a tela é uma sequência, não um painel:
          antes os quatro blocos ficavam empilhados e o vendedor rolava três
          telas para chegar nos vídeos, passando por seções que já tinha
          resolvido. Uma etapa por vez cabe numa dobra e a trilha no topo
          mostra onde ele está sem precisar rolar para descobrir.
        */}
        <Stepper
          // Sem `nonLinear` o MUI desabilita todo passo à frente do atual, e a
          // trilha vira enfeite: nem voltar para revisar funcionaria.
          nonLinear
          activeStep={etapa}
          alternativeLabel
          sx={{
            mb: 3,
            '& .MuiStepLabel-label': {
              fontWeight: 600,
              transition: 'color .2s',
              '&.Mui-active': { fontWeight: 800 },
            },
            '& .MuiStepIcon-root': {
              transition: 'transform .2s, color .2s',
              '&.Mui-active': {
                transform: 'scale(1.25)',
                filter: 'drop-shadow(0 3px 8px rgba(254,44,85,0.4))',
              },
              '&.Mui-completed': { color: 'success.main' },
            },
            '& .MuiStepConnector-line': { borderTopWidth: 2 },
            '& .Mui-completed + * .MuiStepConnector-line, & .Mui-active .MuiStepConnector-line':
              {
                borderColor: 'primary.main',
              },
          }}
        >
          {ETAPAS.map((rotulo, i) => (
            <Step key={rotulo} completed={i < etapa && etapaConcluida(i)}>
              {/*
                Voltar é sempre livre, para revisar o que já foi feito.
                Avançar exige o requisito da etapa — menos para "Vídeos", que
                é só a galeria: quem abriu a tela para rever o que já montou
                não pode ser obrigado a refazer o fluxo inteiro para chegar lá.
              */}
              <StepButton
                disabled={i > etapa && i !== ETAPA_VIDEOS}
                onClick={() => setEtapa(i)}
              >
                {rotulo}
              </StepButton>
            </Step>
          ))}
        </Stepper>

        <Card sx={{ mb: 2, display: etapa === 0 ? 'block' : 'none', ...ENTRADA_DE_ETAPA }}>
          <CardContent>
            <Passo
              numero={1}
              titulo="Identifique o produto"
              descricao="A sigla nomeia todos os arquivos gerados."
              concluido={Boolean(sigla.trim())}
            />
            {/* As duas colunas seguem a MESMA anatomia — rótulo em cima, campo
                embaixo, legenda no pé — para os campos ficarem na mesma linha
                de base. O nome do arquivo era `helperText` só do TextField, o
                que empurrava a altura de uma coluna e desalinhava a outra. */}
            <Grid container spacing={2} alignItems="flex-start">
              <Grid item xs={12} sm={5}>
                <Typography
                  variant="caption"
                  color="text.secondary"
                  display="block"
                  mb={0.5}
                  fontWeight={600}
                >
                  Sigla do produto
                </Typography>
                <TextField
                  fullWidth
                  required
                  size="small"
                  placeholder="Ex.: CINTA"
                  value={sigla}
                  inputProps={{
                    maxLength: 10,
                    style: { textTransform: 'uppercase' },
                    'aria-label': 'Sigla do produto',
                  }}
                  onChange={(e) => setSigla(e.target.value)}
                />
                <Typography
                  variant="caption"
                  color="text.secondary"
                  display="block"
                  mt={0.5}
                  sx={{ fontFamily: 'monospace', fontSize: 11 }}
                >
                  {sigla.trim().toUpperCase() || '[SIGLA]'}_G1C2A3_DDMM.mp4
                </Typography>
              </Grid>
              <Grid item xs={12} sm={7}>
                <Typography
                  variant="caption"
                  color="text.secondary"
                  display="block"
                  mb={0.5}
                  fontWeight={600}
                >
                  Formato de saída
                </Typography>
                <ToggleButtonGroup
                  exclusive
                  fullWidth
                  size="small"
                  orientation={isMobile ? 'vertical' : 'horizontal'}
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

        <Card sx={{ mb: 2, display: etapa === 1 ? 'block' : 'none', ...ENTRADA_DE_ETAPA }}>
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
                    <Grid item xs={12} md={4} key={bloco.role}>
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
                        onSetProduto={(id, produto) =>
                          void handleSetProduto(id, produto)
                        }
                      />
                    </Grid>
                  ))}
                </Grid>
          </CardContent>
        </Card>

        <Grid
          container
          spacing={3}
          sx={{ display: etapa >= 2 ? 'flex' : 'none', ...ENTRADA_DE_ETAPA }}
        >
          <Grid item xs={12} md={5} sx={{ display: etapa === 2 ? 'block' : 'none' }}>
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
                  useFlexGap
                  sx={{
                    mb: 2,
                    p: { xs: 1.5, md: 2 },
                    borderRadius: 3,
                    bgcolor: 'action.hover',
                    border: '1px dashed',
                    borderColor: 'divider',
                    flexWrap: 'wrap',
                    rowGap: 1,
                  }}
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
                      sx={
                        total > 0
                          ? {
                              background:
                                'linear-gradient(135deg, #fe2c55 0%, #7c4dff 100%)',
                              backgroundClip: 'text',
                              WebkitBackgroundClip: 'text',
                              color: 'transparent',
                            }
                          : { color: 'text.disabled' }
                      }
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
                {clipesLongos.length > 0 && (
                  <Alert severity="error" sx={{ mb: 2 }}>
                    {clipesLongos.length === 1
                      ? 'Um clipe é longo demais para o bloco em que está'
                      : `${clipesLongos.length} clipes são longos demais para o bloco em que estão`}{' '}
                    ({clipesLongos.map((c) => c.label).join(', ')}). Corte para
                    o alvo — {FAIXAS_DE_DURACAO.hook.alvo}s de gancho,{' '}
                    {FAIXAS_DE_DURACAO.body.alvo}s de corpo e{' '}
                    {FAIXAS_DE_DURACAO.cta.alvo}s de CTA — e envie de novo.
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

          <Grid item xs={12} md={etapa === 2 ? 7 : 12}>
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
                    <Box sx={{ minWidth: 0 }}>
                      <Typography variant="h6" sx={{ wordBreak: 'break-word' }}>
                        {result.sigla} — {result.combinations.length}{' '}
                        {plural(result.combinations.length, 'combinação', 'combinações')}
                      </Typography>
                      <Typography variant="caption" color="text.secondary">
                        {result.format} ·{' '}
                        {videos.length
                          ? 'montagem em vídeo'
                          : `matriz gerada — montar custa ${custoEmCreditos} ${plural(custoEmCreditos, 'crédito', 'créditos')}`}
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
                        // Um clipe acima do limite faz o servidor recusar a
                        // montagem inteira: deixar o botão ativo só gasta um
                        // clique para receber o mesmo "não" com mais espera.
                        // O saldo entra pela mesma lógica: uma matriz cheia são
                        // 150 créditos, e esta era a única tela do produto onde
                        // um gasto desse tamanho não era barrado antes do clique.
                        disabled={
                          montando || clipesLongos.length > 0 || saldoInsuficiente
                        }
                        onClick={() => void handleRender(result.id)}
                      >
                        {montando
                          ? 'Montando...'
                          : saldoInsuficiente
                            ? 'Créditos insuficientes'
                            : 'Montar vídeos'}
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
                <Box sx={{ textAlign: 'center', py: { xs: 3, md: 6 } }}>
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

        {/* A navegação fica FORA dos cards de etapa: é a mesma barra o tempo
            todo, e movê-la junto com o conteúdo faria o botão "Continuar"
            saltar de posição a cada passo. */}
        <Stack
          direction="row"
          spacing={1}
          justifyContent="space-between"
          alignItems="center"
          sx={{
            mt: 2,
            px: { xs: 1, md: 2 },
            py: 1,
            borderRadius: 3,
            border: '1px solid',
            borderColor: 'divider',
            bgcolor: 'background.paper',
            position: 'sticky',
            bottom: 12,
            zIndex: 2,
            boxShadow: '0 6px 24px rgba(22,24,35,0.10)',
          }}
        >
          <Button
            disabled={etapa === 0}
            onClick={() => setEtapa((e) => Math.max(e - 1, 0))}
            sx={{ flexShrink: 0 }}
          >
            Voltar
          </Button>
          <Typography
            variant="caption"
            color="text.secondary"
            sx={{ textAlign: 'center', flex: 1, px: 1, minWidth: 0 }}
          >
            {DICA_DA_ETAPA[etapa]}
          </Typography>
          <Button
            variant="contained"
            disabled={etapa >= ETAPAS.length - 1 || !etapaConcluida(etapa)}
            onClick={() => setEtapa((e) => Math.min(e + 1, ETAPAS.length - 1))}
            sx={{ flexShrink: 0 }}
          >
            Continuar
          </Button>
        </Stack>
      </form>

      <Box sx={{ mt: 3, display: etapa === 3 ? 'block' : 'none', ...ENTRADA_DE_ETAPA }}>
        <Galeria grupos={galeria} onRecarregar={recarregarGaleria} />
      </Box>

      <Card sx={{ mt: 3 }}>
        <CardContent>
          <Stack direction="row" alignItems="baseline" spacing={1} sx={{ mb: 1.5 }}>
            <Typography variant="h6">Planos salvos</Typography>
            {plans.length > 0 && (
              <Typography variant="caption" color="text.secondary">
                {plans.length} {plural(plans.length, 'plano', 'planos')}
              </Typography>
            )}
          </Stack>
          {plans.length === 0 ? (
            <Typography variant="body2" color="text.secondary">
              Nenhum plano salvo ainda. Gere sua primeira matriz de combinações!
            </Typography>
          ) : (
            <Stack spacing={1}>
              {plans.map((plan) => {
                const aberto = expanded === plan.id;
                const contagens = [
                  { bloco: BLOCOS[0], n: plan.hooks.length },
                  { bloco: BLOCOS[1], n: plan.bodies.length },
                  { bloco: BLOCOS[2], n: plan.ctas.length },
                ];
                return (
                  <Box
                    key={plan.id}
                    sx={{
                      border: '1px solid',
                      borderColor: aberto ? 'primary.main' : 'divider',
                      borderRadius: 2,
                      transition: 'border-color .15s, background-color .15s',
                      '&:hover': { bgcolor: aberto ? 'transparent' : 'action.hover' },
                    }}
                  >
                    {/* A linha inteira abre o plano — o alvo de clique deixa
                        de ser um ícone de 30px no canto. */}
                    <Stack
                      direction="row"
                      alignItems="center"
                      spacing={1.5}
                      onClick={() => void handleToggleExpand(plan.id)}
                      sx={{
                        px: 1.5,
                        py: 1,
                        cursor: 'pointer',
                        userSelect: 'none',
                        flexWrap: 'wrap',
                        rowGap: 0.5,
                      }}
                    >
                      <Typography sx={{ fontWeight: 700 }}>{plan.sigla}</Typography>
                      <Chip size="small" variant="outlined" label={plan.format} />
                      {/* A fórmula do plano nas cores dos blocos — a mesma
                          linguagem do resto da tela, em vez de uma frase. */}
                      <Stack
                        direction="row"
                        alignItems="center"
                        spacing={0.5}
                        useFlexGap
                        sx={{ flexWrap: 'wrap', rowGap: 0.25 }}
                      >
                        {contagens.map(({ bloco, n }, i) => (
                          <Stack
                            key={bloco.role}
                            direction="row"
                            alignItems="center"
                            spacing={0.5}
                          >
                            {i > 0 && (
                              <Typography variant="caption" color="text.disabled">
                                ×
                              </Typography>
                            )}
                            <Box
                              sx={{
                                px: 0.6,
                                py: 0.1,
                                borderRadius: 0.75,
                                fontSize: 11,
                                fontWeight: 700,
                                fontFamily: 'monospace',
                                color: bloco.texto,
                                bgcolor: bloco.cor,
                              }}
                            >
                              {n}
                              {bloco.letra}
                            </Box>
                          </Stack>
                        ))}
                        <Typography variant="caption" color="text.secondary">
                          = {plan.total} {plural(plan.total, 'vídeo', 'vídeos')}
                        </Typography>
                      </Stack>
                      <Box sx={{ flexGrow: 1 }} />
                      <Typography variant="caption" color="text.secondary">
                        {new Date(plan.createdAt).toLocaleDateString('pt-BR')}
                      </Typography>
                      <Tooltip title="Excluir plano — os vídeos já montados continuam na galeria">
                        <IconButton
                          size="small"
                          aria-label="Excluir plano"
                          onClick={(e) => {
                            e.stopPropagation();
                            void handleDeletePlan(plan.id);
                          }}
                          sx={{ color: 'text.disabled', '&:hover': { color: 'error.main' } }}
                        >
                          <DeleteOutlineRoundedIcon fontSize="small" />
                        </IconButton>
                      </Tooltip>
                      <IconButton size="small" aria-label="Ver combinações">
                        {aberto ? (
                          <ExpandLessRoundedIcon fontSize="small" />
                        ) : (
                          <ExpandMoreRoundedIcon fontSize="small" />
                        )}
                      </IconButton>
                    </Stack>
                    <Collapse in={aberto} unmountOnExit>
                      <Box sx={{ px: 1.5, pb: 1.5 }}>
                        {expandedDetail && expandedDetail.id === plan.id ? (
                          <>
                            <Stack
                              direction="row"
                              spacing={1}
                              flexWrap="wrap"
                              useFlexGap
                              sx={{ mb: 1 }}
                            >
                              <Button
                                size="small"
                                variant="outlined"
                                startIcon={<ContentCopyRoundedIcon />}
                                onClick={() => handleCopy(expandedDetail.combinations)}
                              >
                                Copiar lista
                              </Button>
                              <Button
                                size="small"
                                variant="outlined"
                                startIcon={<DownloadRoundedIcon />}
                                onClick={() => handleDownloadCsv(expandedDetail)}
                              >
                                Baixar CSV
                              </Button>
                              <Button
                                size="small"
                                variant="contained"
                                startIcon={<MovieFilterRoundedIcon />}
                                onClick={() => void handleRender(plan.id)}
                              >
                                Montar vídeos
                              </Button>
                            </Stack>
                            {renderCombinationsTable(expandedDetail.combinations)}
                          </>
                        ) : (
                          <Stack direction="row" alignItems="center" spacing={1}>
                            <CircularProgress size={14} />
                            <Typography variant="caption" color="text.secondary">
                              Carregando…
                            </Typography>
                          </Stack>
                        )}
                      </Box>
                    </Collapse>
                  </Box>
                );
              })}
            </Stack>
          )}
        </CardContent>
      </Card>
      {dialogo}
    </Box>
  );
}
