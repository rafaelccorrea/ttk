import AutoAwesomeRoundedIcon from '@mui/icons-material/AutoAwesomeRounded';
import CloseRoundedIcon from '@mui/icons-material/CloseRounded';
import DeleteOutlineRoundedIcon from '@mui/icons-material/DeleteOutlineRounded';
import DownloadRoundedIcon from '@mui/icons-material/DownloadRounded';
import ErrorOutlineRoundedIcon from '@mui/icons-material/ErrorOutlineRounded';
import FullscreenRoundedIcon from '@mui/icons-material/FullscreenRounded';
import ImageRoundedIcon from '@mui/icons-material/ImageRounded';
import MovieFilterRoundedIcon from '@mui/icons-material/MovieFilterRounded';
import PlayArrowRoundedIcon from '@mui/icons-material/PlayArrowRounded';
import RefreshRoundedIcon from '@mui/icons-material/RefreshRounded';
import {
  Alert,
  Box,
  Button,
  Chip,
  Dialog,
  IconButton,
  keyframes,
  Skeleton,
  Snackbar,
  Stack,
  Tooltip,
  Typography,
  useMediaQuery,
  useTheme,
} from '@mui/material';
import { ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useConfirmacao } from '@/components/ui/ConfirmDialog';
import { GeneratedMedia, videogenService } from '@/services/videogen.service';

// ---------------------------------------------------------------- domínio

const PENDING: GeneratedMedia['status'][] = ['queued', 'in_progress'];

const STATUS_LABEL: Record<GeneratedMedia['status'], string> = {
  queued: 'Na fila',
  in_progress: 'Gerando',
  completed: 'Pronto',
  failed: 'Falhou',
  nsfw: 'Bloqueado',
  canceled: 'Cancelado',
};

type Tom = { bg: string; color: string; dot: string };

function tomDoStatus(status: GeneratedMedia['status']): Tom {
  if (status === 'completed')
    return { bg: 'rgba(22,163,74,0.12)', color: '#15803d', dot: '#16a34a' };
  if (PENDING.includes(status))
    return { bg: 'rgba(0,194,187,0.14)', color: '#0f766e', dot: '#00c2bb' };
  return { bg: 'rgba(220,38,38,0.10)', color: '#b91c1c', dot: '#dc2626' };
}

function ehPendente(item: GeneratedMedia): boolean {
  return PENDING.includes(item.status);
}

/** "12/08 às 19:45" — o card se identifica pela data, não pelo prompt. */
function quandoGerou(iso: string): string {
  const data = new Date(iso);
  const dia = data.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
  const hora = data.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  return `${dia} às ${hora}`;
}

/** "Hoje", "Ontem", "Esta semana"… — agrupamento da galeria por data. */
function grupoDaData(iso: string): string {
  const data = new Date(iso);
  const hoje = new Date();
  const inicioHoje = new Date(hoje.getFullYear(), hoje.getMonth(), hoje.getDate());
  const diff = (inicioHoje.getTime() - data.getTime()) / 86_400_000;
  if (diff < 0) return 'Hoje';
  if (diff < 1) return 'Ontem';
  if (diff < 7) return 'Esta semana';
  if (diff < 30) return 'Este mês';
  return 'Mais antigas';
}

const ORDEM_GRUPOS = ['Hoje', 'Ontem', 'Esta semana', 'Este mês', 'Mais antigas'];

type FiltroTipo = 'todos' | 'video' | 'image';
type FiltroStatus = 'todos' | 'pendente' | 'pronto' | 'falha';

// -------------------------------------------------------------- animações

const brilho = keyframes`
  0% { background-position: 200% center; }
  100% { background-position: -200% center; }
`;

const flutua = keyframes`
  0%, 100% { transform: translateY(0); }
  50% { transform: translateY(-6px); }
`;

const pulsa = keyframes`
  0%, 100% { opacity: 1; }
  50% { opacity: 0.45; }
`;

const gira = keyframes`
  to { transform: rotate(360deg); }
`;

const SEM_MOVIMENTO = { '@media (prefers-reduced-motion: reduce)': { animation: 'none' } };

// ------------------------------------------------------------- componentes

/** Bolinha de status — pulsa quando a geração ainda está rodando. */
function PontoDeStatus({ tom, ativo }: { tom: Tom; ativo: boolean }) {
  return (
    <Box
      component="span"
      sx={{
        width: 7,
        height: 7,
        borderRadius: '50%',
        bgcolor: tom.dot,
        flexShrink: 0,
        boxShadow: ativo ? `0 0 0 3px ${tom.bg}` : 'none',
        animation: ativo ? `${pulsa} 1.4s ease-in-out infinite` : 'none',
        ...SEM_MOVIMENTO,
      }}
    />
  );
}

/** Pílula de filtro, no mesmo visual "soft" dos filtros do resto do app. */
function Pilula({
  ativo,
  onClick,
  children,
  contagem,
}: {
  ativo: boolean;
  onClick: () => void;
  children: ReactNode;
  contagem?: number;
}) {
  return (
    <Box
      component="button"
      type="button"
      onClick={onClick}
      sx={{
        all: 'unset',
        cursor: 'pointer',
        display: 'inline-flex',
        alignItems: 'center',
        gap: 0.75,
        px: 1.75,
        height: 34,
        borderRadius: 999,
        fontSize: 13.5,
        fontWeight: 700,
        whiteSpace: 'nowrap',
        border: '1px solid',
        borderColor: ativo ? 'transparent' : 'rgba(22,24,35,0.10)',
        color: ativo ? '#fff' : 'text.primary',
        background: ativo
          ? 'linear-gradient(135deg, #fe2c55 0%, #ff5c7a 100%)'
          : 'rgba(22,24,35,0.03)',
        boxShadow: ativo ? '0 6px 18px rgba(254,44,85,0.28)' : 'none',
        transition: 'all .18s ease',
        '&:hover': {
          transform: 'translateY(-1px)',
          borderColor: ativo ? 'transparent' : 'rgba(22,24,35,0.22)',
        },
        '&:focus-visible': { outline: '2px solid #fe2c55', outlineOffset: 2 },
      }}
    >
      {children}
      {contagem !== undefined && (
        <Box
          component="span"
          sx={{
            fontSize: 11,
            fontWeight: 800,
            px: 0.75,
            minWidth: 20,
            height: 20,
            borderRadius: 999,
            display: 'grid',
            placeItems: 'center',
            bgcolor: ativo ? 'rgba(255,255,255,0.22)' : 'rgba(22,24,35,0.07)',
            color: ativo ? '#fff' : 'text.secondary',
          }}
        >
          {contagem}
        </Box>
      )}
    </Box>
  );
}

/** Métrica do cabeçalho: número grande + rótulo, com ícone em gradiente. */
function Metrica({
  icone,
  valor,
  rotulo,
  ativa,
}: {
  icone: ReactNode;
  valor: number;
  rotulo: string;
  ativa?: boolean;
}) {
  return (
    <Box
      sx={{
        display: 'flex',
        alignItems: 'center',
        gap: 1.25,
        px: 1.75,
        py: 1.25,
        borderRadius: 3,
        bgcolor: 'rgba(255,255,255,0.7)',
        border: '1px solid rgba(22,24,35,0.06)',
        backdropFilter: 'blur(8px)',
        minWidth: 0,
      }}
    >
      <Box
        sx={{
          width: 36,
          height: 36,
          borderRadius: 2.5,
          display: 'grid',
          placeItems: 'center',
          flexShrink: 0,
          color: ativa ? '#0f766e' : 'primary.main',
          background: ativa
            ? 'linear-gradient(135deg, rgba(0,194,187,0.18), rgba(37,244,238,0.18))'
            : 'linear-gradient(135deg, rgba(254,44,85,0.12), rgba(37,244,238,0.12))',
          '& svg': {
            fontSize: 20,
            animation: ativa ? `${gira} 1.8s linear infinite` : 'none',
          },
          ...SEM_MOVIMENTO,
        }}
      >
        {icone}
      </Box>
      <Box minWidth={0}>
        <Typography sx={{ fontWeight: 800, fontSize: 20, lineHeight: 1.1 }}>{valor}</Typography>
        <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 600 }} noWrap>
          {rotulo}
        </Typography>
      </Box>
    </Box>
  );
}

/** Progresso por fase das gerações: frame base → animação (vídeo) ou imagem. */
function ProgressoDeFase({ item }: { item: GeneratedMedia }) {
  const etapas = item.kind === 'video' ? ['Frame base', 'Animação'] : ['Imagem'];
  const atual = item.kind === 'video' && item.phase === 'video' ? 1 : 0;
  const naFila = item.status === 'queued';

  const texto = naFila
    ? 'Aguardando na fila…'
    : item.kind === 'video'
      ? atual === 0
        ? 'Criando o frame base…'
        : 'Animando o vídeo…'
      : 'Gerando a imagem…';

  return (
    <Box sx={{ width: '100%', px: 2 }}>
      <Stack direction="row" spacing={0.75} mb={1}>
        {etapas.map((nome, i) => {
          const feita = i < atual;
          const rodando = i === atual && !naFila;
          return (
            <Box
              key={nome}
              sx={{
                flex: 1,
                height: 5,
                borderRadius: 99,
                overflow: 'hidden',
                bgcolor: 'rgba(255,255,255,0.18)',
                position: 'relative',
                '&::after': {
                  content: '""',
                  position: 'absolute',
                  inset: 0,
                  borderRadius: 99,
                  background: 'linear-gradient(90deg, #fe2c55, #25f4ee, #fe2c55)',
                  backgroundSize: '200% auto',
                  opacity: feita || rodando ? 1 : 0,
                  animation: rodando ? `${brilho} 1.6s linear infinite` : 'none',
                  ...SEM_MOVIMENTO,
                },
              }}
            />
          );
        })}
      </Stack>
      <Typography
        variant="caption"
        sx={{ fontWeight: 700, display: 'block', textAlign: 'center' }}
      >
        {texto}
      </Typography>
    </Box>
  );
}

const VIDRO = {
  color: '#fff',
  bgcolor: 'rgba(22,24,35,0.55)',
  backdropFilter: 'blur(6px)',
  border: '1px solid rgba(255,255,255,0.18)',
} as const;

function CardDeMidia({
  item,
  onExcluir,
  onAbrir,
}: {
  item: GeneratedMedia;
  onExcluir: (item: GeneratedMedia) => void;
  onAbrir: (item: GeneratedMedia) => void;
}) {
  const tom = tomDoStatus(item.status);
  const pendente = ehPendente(item);
  const pronto = item.status === 'completed' && Boolean(item.outputUrl);
  const vertical = item.aspectRatio === '9:16';
  const videoRef = useRef<HTMLVideoElement | null>(null);

  // Vídeo pronto dá preview ao passar o mouse; volta ao frame inicial ao sair.
  function tocarPreview() {
    void videoRef.current?.play().catch(() => undefined);
  }
  function pararPreview() {
    const v = videoRef.current;
    if (!v) return;
    v.pause();
    v.currentTime = 0;
  }

  return (
    <Box
      sx={{
        position: 'relative',
        borderRadius: 4,
        overflow: 'hidden',
        bgcolor: 'background.paper',
        border: '1px solid rgba(22,24,35,0.08)',
        boxShadow: '0 1px 3px rgba(22,24,35,0.05)',
        transition: 'transform .2s ease, box-shadow .2s ease, border-color .2s ease',
        '&:hover': {
          transform: 'translateY(-4px)',
          boxShadow: '0 18px 40px rgba(22,24,35,0.14)',
          borderColor: 'rgba(22,24,35,0.16)',
          '& .acoes': { opacity: 1, transform: 'translateY(0)' },
          '& .play': { opacity: 0 },
        },
        // Borda animada em gradiente enquanto gera.
        ...(pendente && {
          '&::before': {
            content: '""',
            position: 'absolute',
            inset: 0,
            borderRadius: 'inherit',
            padding: '1.5px',
            background: 'linear-gradient(120deg, #fe2c55, #25f4ee, #fe2c55)',
            backgroundSize: '200% auto',
            animation: `${brilho} 2.4s linear infinite`,
            WebkitMask: 'linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0)',
            WebkitMaskComposite: 'xor',
            maskComposite: 'exclude',
            pointerEvents: 'none',
            zIndex: 2,
            ...SEM_MOVIMENTO,
          },
        }),
      }}
    >
      {/* Mídia */}
      <Box
        onMouseEnter={pronto && item.kind === 'video' ? tocarPreview : undefined}
        onMouseLeave={pronto && item.kind === 'video' ? pararPreview : undefined}
        onClick={pronto ? () => onAbrir(item) : undefined}
        sx={{
          position: 'relative',
          aspectRatio: vertical ? '9 / 13' : '16 / 10',
          bgcolor: '#161823',
          display: 'grid',
          placeItems: 'center',
          overflow: 'hidden',
          cursor: pronto ? 'zoom-in' : 'default',
        }}
      >
        {pronto ? (
          item.kind === 'video' ? (
            <>
              <Box
                component="video"
                ref={videoRef}
                src={item.outputUrl ?? undefined}
                loop
                muted
                playsInline
                preload="metadata"
                sx={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
              />
              <Box
                className="play"
                sx={{
                  position: 'absolute',
                  inset: 0,
                  display: 'grid',
                  placeItems: 'center',
                  transition: 'opacity .2s ease',
                  pointerEvents: 'none',
                }}
              >
                <Box
                  sx={{
                    ...VIDRO,
                    width: 52,
                    height: 52,
                    borderRadius: '50%',
                    display: 'grid',
                    placeItems: 'center',
                  }}
                >
                  <PlayArrowRoundedIcon sx={{ fontSize: 30 }} />
                </Box>
              </Box>
            </>
          ) : (
            <Box
              component="img"
              src={item.outputUrl ?? undefined}
              // O prompt NÃO aparece em lugar nenhum do card — nem no alt. Ele
              // é a receita interna da geração, texto de máquina que só expõe
              // o bastidor.
              alt="Imagem gerada por IA"
              loading="lazy"
              sx={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
            />
          )
        ) : pendente ? (
          <>
            {item.imageUrl ? (
              <Box
                component="img"
                src={item.imageUrl}
                alt="frame base"
                sx={{
                  position: 'absolute',
                  inset: 0,
                  width: '100%',
                  height: '100%',
                  objectFit: 'cover',
                  opacity: 0.5,
                  filter: 'saturate(0.7)',
                }}
              />
            ) : (
              <Box
                sx={{
                  position: 'absolute',
                  inset: 0,
                  background:
                    'linear-gradient(110deg, #1c1e2b 30%, #2a2d3e 50%, #1c1e2b 70%)',
                  backgroundSize: '200% auto',
                  animation: `${brilho} 2s linear infinite`,
                  ...SEM_MOVIMENTO,
                }}
              />
            )}
            <Box
              sx={{
                position: 'relative',
                width: '100%',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: 1.5,
                color: 'rgba(255,255,255,0.9)',
              }}
            >
              <Box
                component="img"
                src="/icon-192.png"
                alt=""
                sx={{
                  width: 44,
                  height: 44,
                  borderRadius: '24%',
                  boxShadow: '0 8px 24px rgba(254,44,85,0.45)',
                  animation: `${flutua} 2.2s ease-in-out infinite`,
                  ...SEM_MOVIMENTO,
                }}
              />
              <ProgressoDeFase item={item} />
            </Box>
          </>
        ) : (
          <Stack alignItems="center" spacing={1} px={2.5} textAlign="center">
            <ErrorOutlineRoundedIcon sx={{ color: '#ff6b81', fontSize: 34 }} />
            <Typography variant="body2" sx={{ color: 'rgba(255,255,255,0.8)' }}>
              {item.error ?? 'A geração não foi concluída.'}
            </Typography>
          </Stack>
        )}

        {/* Selo do tipo no canto */}
        <Chip
          size="small"
          icon={
            item.kind === 'video' ? (
              <MovieFilterRoundedIcon sx={{ fontSize: 15, color: '#fff !important' }} />
            ) : (
              <ImageRoundedIcon sx={{ fontSize: 15, color: '#fff !important' }} />
            )
          }
          label={item.kind === 'video' ? 'Vídeo' : 'Imagem'}
          sx={{
            ...VIDRO,
            position: 'absolute',
            top: 10,
            left: 10,
            height: 26,
            fontWeight: 800,
            fontSize: 11.5,
            pointerEvents: 'none',
          }}
        />

        {/* Ações flutuantes (aparecem no hover; sempre visíveis no touch) */}
        <Stack
          className="acoes"
          direction="row"
          spacing={0.5}
          onClick={(e) => e.stopPropagation()}
          sx={{
            position: 'absolute',
            top: 8,
            right: 8,
            opacity: { xs: 1, md: 0 },
            transform: { xs: 'none', md: 'translateY(-4px)' },
            transition: 'opacity .2s ease, transform .2s ease',
            '& .MuiIconButton-root': {
              ...VIDRO,
              width: 32,
              height: 32,
              '&:hover': { bgcolor: 'rgba(22,24,35,0.8)' },
            },
          }}
        >
          {pronto && (
            <>
              <Tooltip title="Ver em tela cheia">
                <IconButton size="small" onClick={() => onAbrir(item)}>
                  <FullscreenRoundedIcon sx={{ fontSize: 18 }} />
                </IconButton>
              </Tooltip>
              <Tooltip title="Baixar">
                <IconButton
                  size="small"
                  component="a"
                  href={item.outputUrl ?? undefined}
                  target="_blank"
                  rel="noreferrer"
                  download
                >
                  <DownloadRoundedIcon sx={{ fontSize: 18 }} />
                </IconButton>
              </Tooltip>
            </>
          )}
          <Tooltip title="Excluir">
            <IconButton
              size="small"
              onClick={() => onExcluir(item)}
              sx={{ '&:hover': { bgcolor: 'rgba(220,38,38,0.85) !important' } }}
            >
              <DeleteOutlineRoundedIcon sx={{ fontSize: 18 }} />
            </IconButton>
          </Tooltip>
        </Stack>
      </Box>

      {/* Rodapé */}
      <Box
        sx={{
          px: 1.75,
          py: 1.25,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 1,
        }}
      >
        <Box
          sx={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 0.75,
            px: 1.25,
            height: 26,
            borderRadius: 999,
            fontSize: 12,
            fontWeight: 800,
            bgcolor: tom.bg,
            color: tom.color,
          }}
        >
          <PontoDeStatus tom={tom} ativo={pendente} />
          {STATUS_LABEL[item.status]}
        </Box>
        <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 600 }} noWrap>
          {quandoGerou(item.createdAt)}
          {item.aspectRatio ? ` · ${item.aspectRatio}` : ''}
        </Typography>
      </Box>
    </Box>
  );
}

/** Esqueleto do card enquanto a lista carrega. */
function CardEsqueleto({ i }: { i: number }) {
  return (
    <Box sx={{ borderRadius: 4, overflow: 'hidden', border: '1px solid rgba(22,24,35,0.08)' }}>
      <Skeleton
        variant="rectangular"
        sx={{ aspectRatio: i % 3 === 1 ? '16 / 10' : '9 / 13', height: 'auto' }}
      />
      <Box px={1.75} py={1.25} display="flex" justifyContent="space-between">
        <Skeleton width={80} height={26} sx={{ borderRadius: 99 }} />
        <Skeleton width={90} height={20} />
      </Box>
    </Box>
  );
}

/** Lightbox: a mídia em tela cheia, sem o resto da página em volta. */
function Lightbox({ item, onFechar }: { item: GeneratedMedia | null; onFechar: () => void }) {
  const theme = useTheme();
  const noCelular = useMediaQuery(theme.breakpoints.down('sm'));
  const midiaSx = {
    display: 'block',
    maxWidth: '100%',
    maxHeight: noCelular ? '100vh' : '88vh',
    width: noCelular ? '100%' : 'auto',
    height: noCelular ? '100%' : 'auto',
    objectFit: 'contain',
    margin: '0 auto',
  } as const;

  return (
    <Dialog
      open={Boolean(item)}
      onClose={onFechar}
      fullScreen={noCelular}
      maxWidth="lg"
      PaperProps={{
        sx: {
          bgcolor: '#0f1017',
          borderRadius: noCelular ? 0 : 4,
          overflow: 'hidden',
          backgroundImage: 'none',
        },
      }}
      slotProps={{
        backdrop: { sx: { bgcolor: 'rgba(10,10,16,0.82)', backdropFilter: 'blur(6px)' } },
      }}
    >
      <IconButton
        onClick={onFechar}
        aria-label="Fechar"
        sx={{
          position: 'absolute',
          top: 10,
          right: 10,
          zIndex: 2,
          color: '#fff',
          bgcolor: 'rgba(255,255,255,0.12)',
          '&:hover': { bgcolor: 'rgba(255,255,255,0.22)' },
        }}
      >
        <CloseRoundedIcon />
      </IconButton>
      {item?.outputUrl &&
        (item.kind === 'video' ? (
          <Box
            component="video"
            src={item.outputUrl}
            controls
            autoPlay
            loop
            playsInline
            sx={midiaSx}
          />
        ) : (
          <Box component="img" src={item.outputUrl} alt="Imagem gerada por IA" sx={midiaSx} />
        ))}
      {item && (
        <Stack
          direction="row"
          spacing={1}
          alignItems="center"
          sx={{ position: 'absolute', bottom: 12, left: 12, zIndex: 2 }}
        >
          <Button
            size="small"
            variant="contained"
            startIcon={<DownloadRoundedIcon />}
            component="a"
            href={item.outputUrl ?? undefined}
            target="_blank"
            rel="noreferrer"
            download
          >
            Baixar
          </Button>
          <Chip
            size="small"
            label={`${item.kind === 'video' ? 'Vídeo' : 'Imagem'} · ${quandoGerou(item.createdAt)}`}
            sx={{ color: '#fff', bgcolor: 'rgba(255,255,255,0.12)', fontWeight: 700 }}
          />
        </Stack>
      )}
    </Dialog>
  );
}

// ------------------------------------------------------------------ página

const GRID_SX = {
  display: 'grid',
  gap: { xs: 1.5, sm: 2, md: 2.5 },
  gridTemplateColumns: {
    xs: 'repeat(2, minmax(0, 1fr))',
    sm: 'repeat(auto-fill, minmax(220px, 1fr))',
    md: 'repeat(auto-fill, minmax(240px, 1fr))',
  },
} as const;

export function GenerationsPage() {
  const [items, setItems] = useState<GeneratedMedia[]>([]);
  const [loading, setLoading] = useState(true);
  const [atualizando, setAtualizando] = useState(false);
  const [filtroTipo, setFiltroTipo] = useState<FiltroTipo>('todos');
  const [filtroStatus, setFiltroStatus] = useState<FiltroStatus>('todos');
  const [aberto, setAberto] = useState<GeneratedMedia | null>(null);
  const [aviso, setAviso] = useState<{ msg: string; tipo: 'success' | 'error' } | null>(null);
  const { confirmar, dialogoDeConfirmacao } = useConfirmacao();
  const itemsRef = useRef(items);
  itemsRef.current = items;

  const load = useCallback(async () => {
    setAtualizando(true);
    try {
      setItems(await videogenService.list());
    } catch (error) {
      console.error(error);
      setAviso({ msg: 'Não foi possível carregar as gerações.', tipo: 'error' });
    } finally {
      setLoading(false);
      setAtualizando(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // Enquanto houver gerações pendentes, atualiza todas a cada 6s — em paralelo.
  useEffect(() => {
    const timer = setInterval(async () => {
      const pendentes = itemsRef.current.filter(ehPendente);
      if (pendentes.length === 0) return;
      const resultados = await Promise.allSettled(
        pendentes.map((item) => videogenService.refresh(item.id)),
      );
      const atualizados = resultados
        .filter((r): r is PromiseFulfilledResult<GeneratedMedia> => r.status === 'fulfilled')
        .map((r) => r.value);
      if (atualizados.length === 0) return;
      const concluiu = atualizados.some((a) => a.status === 'completed');
      setItems((prev) => prev.map((p) => atualizados.find((a) => a.id === p.id) ?? p));
      if (concluiu) setAviso({ msg: 'Uma geração ficou pronta! ✨', tipo: 'success' });
    }, 6000);
    return () => clearInterval(timer);
  }, []);

  async function excluir(item: GeneratedMedia) {
    const ok = await confirmar({
      titulo: item.kind === 'video' ? 'Apagar este vídeo?' : 'Apagar esta imagem?',
      mensagem: 'A mídia some da sua galeria e não dá para recuperar.',
      textoConfirmar: 'Apagar',
    });
    if (!ok) return;
    try {
      await videogenService.delete(item.id);
      setItems((prev) => prev.filter((p) => p.id !== item.id));
      setAviso({ msg: 'Geração apagada.', tipo: 'success' });
    } catch (error) {
      console.error(error);
      setAviso({ msg: 'Não foi possível apagar. Tente de novo.', tipo: 'error' });
    }
  }

  function limparFiltros() {
    setFiltroTipo('todos');
    setFiltroStatus('todos');
  }

  // Contagens para o cabeçalho e para as pílulas.
  const contagens = useMemo(() => {
    const c = { total: items.length, video: 0, image: 0, pendente: 0, pronto: 0, falha: 0 };
    for (const i of items) {
      c[i.kind] += 1;
      if (ehPendente(i)) c.pendente += 1;
      else if (i.status === 'completed') c.pronto += 1;
      else c.falha += 1;
    }
    return c;
  }, [items]);

  const filtrados = useMemo(
    () =>
      items.filter((i) => {
        if (filtroTipo !== 'todos' && i.kind !== filtroTipo) return false;
        if (filtroStatus === 'pendente') return ehPendente(i);
        if (filtroStatus === 'pronto') return i.status === 'completed';
        if (filtroStatus === 'falha') return !ehPendente(i) && i.status !== 'completed';
        return true;
      }),
    [items, filtroTipo, filtroStatus],
  );

  const grupos = useMemo(() => {
    const mapa = new Map<string, GeneratedMedia[]>();
    for (const i of filtrados) {
      const g = grupoDaData(i.createdAt);
      mapa.set(g, [...(mapa.get(g) ?? []), i]);
    }
    return ORDEM_GRUPOS.filter((g) => mapa.has(g)).map((g) => ({
      titulo: g,
      itens: mapa.get(g) ?? [],
    }));
  }, [filtrados]);

  const temFiltro = filtroTipo !== 'todos' || filtroStatus !== 'todos';

  return (
    <>
      {/* Cabeçalho-vitrine */}
      <Box
        sx={{
          position: 'relative',
          overflow: 'hidden',
          borderRadius: 4,
          p: { xs: 2.5, md: 3.5 },
          mb: 3,
          border: '1px solid',
          borderColor: 'divider',
          bgcolor: 'background.paper',
          backgroundImage:
            'radial-gradient(70% 130% at 100% 0%, rgba(254,44,85,0.12) 0%, transparent 60%),' +
            'radial-gradient(50% 100% at 0% 100%, rgba(0,194,187,0.10) 0%, transparent 60%)',
        }}
      >
        {/* Grade decorativa bem sutil */}
        <Box
          aria-hidden
          sx={{
            position: 'absolute',
            inset: 0,
            backgroundImage:
              'linear-gradient(rgba(22,24,35,0.04) 1px, transparent 1px), linear-gradient(90deg, rgba(22,24,35,0.04) 1px, transparent 1px)',
            backgroundSize: '28px 28px',
            maskImage: 'radial-gradient(80% 80% at 80% 20%, #000 0%, transparent 70%)',
            WebkitMaskImage: 'radial-gradient(80% 80% at 80% 20%, #000 0%, transparent 70%)',
            pointerEvents: 'none',
          }}
        />
        <Box
          sx={{
            position: 'relative',
            display: 'flex',
            flexWrap: 'wrap',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 2,
          }}
        >
          <Box minWidth={0}>
            <Stack direction="row" alignItems="center" spacing={1} mb={0.5}>
              <Box
                sx={{
                  width: 40,
                  height: 40,
                  borderRadius: 3,
                  display: 'grid',
                  placeItems: 'center',
                  flexShrink: 0,
                  color: '#fff',
                  background: 'linear-gradient(135deg, #fe2c55 0%, #00c2bb 100%)',
                  boxShadow: '0 8px 22px rgba(254,44,85,0.30)',
                }}
              >
                <AutoAwesomeRoundedIcon />
              </Box>
              <Typography
                variant="h5"
                sx={{
                  background: 'linear-gradient(90deg, #fe2c55 0%, #00c2bb 100%)',
                  backgroundClip: 'text',
                  WebkitBackgroundClip: 'text',
                  WebkitTextFillColor: 'transparent',
                  width: 'fit-content',
                }}
              >
                Minhas Gerações
              </Typography>
            </Stack>
            <Typography color="text.secondary" variant="body2">
              Sua galeria de imagens e vídeos criados por IA a partir do Cofre de Prompts.
            </Typography>
          </Box>

          <Stack direction="row" spacing={1} sx={{ width: { xs: '100%', sm: 'auto' } }}>
            <Tooltip title="Atualizar lista">
              <span>
                <IconButton
                  onClick={() => void load()}
                  disabled={atualizando}
                  sx={{
                    border: '1px solid rgba(22,24,35,0.12)',
                    bgcolor: 'background.paper',
                    '& svg': { animation: atualizando ? `${gira} 0.9s linear infinite` : 'none' },
                  }}
                >
                  <RefreshRoundedIcon />
                </IconButton>
              </span>
            </Tooltip>
            <Button
              component={Link}
              to="/prompts"
              variant="contained"
              startIcon={<AutoAwesomeRoundedIcon />}
              sx={{ flex: { xs: 1, sm: 'none' } }}
            >
              Nova geração
            </Button>
          </Stack>
        </Box>

        {/* Métricas */}
        <Box
          sx={{
            position: 'relative',
            mt: 2.5,
            display: 'grid',
            gap: 1.25,
            gridTemplateColumns: { xs: 'repeat(2, 1fr)', sm: 'repeat(4, minmax(0, 1fr))' },
          }}
        >
          <Metrica icone={<AutoAwesomeRoundedIcon />} valor={contagens.total} rotulo="Gerações" />
          <Metrica icone={<MovieFilterRoundedIcon />} valor={contagens.video} rotulo="Vídeos" />
          <Metrica icone={<ImageRoundedIcon />} valor={contagens.image} rotulo="Imagens" />
          <Metrica
            icone={<RefreshRoundedIcon />}
            valor={contagens.pendente}
            rotulo="Em andamento"
            ativa={contagens.pendente > 0}
          />
        </Box>
      </Box>

      {/* Filtros */}
      {items.length > 0 && (
        <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 1, mb: 3 }}>
          <Stack direction="row" spacing={0.75} sx={{ overflowX: 'auto', pb: 0.5 }}>
            <Pilula ativo={filtroTipo === 'todos'} onClick={() => setFiltroTipo('todos')}>
              Tudo
            </Pilula>
            <Pilula
              ativo={filtroTipo === 'video'}
              onClick={() => setFiltroTipo('video')}
              contagem={contagens.video}
            >
              <MovieFilterRoundedIcon sx={{ fontSize: 16 }} /> Vídeos
            </Pilula>
            <Pilula
              ativo={filtroTipo === 'image'}
              onClick={() => setFiltroTipo('image')}
              contagem={contagens.image}
            >
              <ImageRoundedIcon sx={{ fontSize: 16 }} /> Imagens
            </Pilula>
          </Stack>
          <Box
            sx={{
              width: '1px',
              height: 22,
              bgcolor: 'divider',
              mx: 0.5,
              display: { xs: 'none', sm: 'block' },
            }}
          />
          <Stack direction="row" spacing={0.75} sx={{ overflowX: 'auto', pb: 0.5 }}>
            <Pilula ativo={filtroStatus === 'todos'} onClick={() => setFiltroStatus('todos')}>
              Qualquer status
            </Pilula>
            <Pilula
              ativo={filtroStatus === 'pendente'}
              onClick={() => setFiltroStatus('pendente')}
              contagem={contagens.pendente}
            >
              Gerando
            </Pilula>
            <Pilula
              ativo={filtroStatus === 'pronto'}
              onClick={() => setFiltroStatus('pronto')}
              contagem={contagens.pronto}
            >
              Prontos
            </Pilula>
            {contagens.falha > 0 && (
              <Pilula
                ativo={filtroStatus === 'falha'}
                onClick={() => setFiltroStatus('falha')}
                contagem={contagens.falha}
              >
                Com erro
              </Pilula>
            )}
          </Stack>
          {temFiltro && (
            <Button size="small" onClick={limparFiltros} sx={{ ml: 'auto', color: 'text.secondary' }}>
              Limpar filtros
            </Button>
          )}
        </Box>
      )}

      {/* Conteúdo */}
      {loading ? (
        <Box sx={GRID_SX}>
          {Array.from({ length: 8 }, (_, i) => (
            <CardEsqueleto key={i} i={i} />
          ))}
        </Box>
      ) : items.length === 0 ? (
        <Box
          sx={{
            textAlign: 'center',
            py: { xs: 6, md: 9 },
            px: { xs: 2, md: 3 },
            borderRadius: 4,
            border: '1px dashed rgba(22,24,35,0.14)',
            bgcolor: 'background.paper',
          }}
        >
          <Box
            sx={{
              width: 84,
              height: 84,
              mx: 'auto',
              mb: 2.5,
              borderRadius: '28%',
              display: 'grid',
              placeItems: 'center',
              color: '#fff',
              background: 'linear-gradient(135deg, #fe2c55 0%, #00c2bb 100%)',
              boxShadow: '0 16px 40px rgba(254,44,85,0.30)',
              animation: `${flutua} 3s ease-in-out infinite`,
              ...SEM_MOVIMENTO,
            }}
          >
            <MovieFilterRoundedIcon sx={{ fontSize: 42 }} />
          </Box>
          <Typography variant="h6" mb={0.75}>
            Sua galeria está vazia
          </Typography>
          <Typography color="text.secondary" mb={3} maxWidth={420} mx="auto">
            Escolha um prompt no Cofre, preencha os campos e clique em{' '}
            <strong>Gerar com IA</strong>. O resultado aparece aqui.
          </Typography>
          <Button
            component={Link}
            to="/prompts"
            variant="contained"
            size="large"
            startIcon={<AutoAwesomeRoundedIcon />}
          >
            Abrir Cofre de Prompts
          </Button>
        </Box>
      ) : filtrados.length === 0 ? (
        <Box
          sx={{ textAlign: 'center', py: 6, borderRadius: 4, border: '1px dashed rgba(22,24,35,0.14)' }}
        >
          <Typography variant="h6" mb={0.5}>
            Nada por aqui com esses filtros
          </Typography>
          <Typography color="text.secondary" mb={2}>
            Tente outra combinação ou limpe os filtros.
          </Typography>
          <Button variant="outlined" onClick={limparFiltros}>
            Limpar filtros
          </Button>
        </Box>
      ) : (
        <Stack spacing={4}>
          {grupos.map((grupo) => (
            <Box key={grupo.titulo}>
              <Stack direction="row" alignItems="center" spacing={1.25} mb={1.5}>
                <Typography
                  variant="overline"
                  sx={{ color: 'text.secondary', fontWeight: 800, lineHeight: 1 }}
                >
                  {grupo.titulo}
                </Typography>
                <Box sx={{ flex: 1, height: '1px', bgcolor: 'divider' }} />
                <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 700 }}>
                  {grupo.itens.length}
                </Typography>
              </Stack>
              <Box sx={GRID_SX}>
                {grupo.itens.map((item) => (
                  <CardDeMidia key={item.id} item={item} onExcluir={excluir} onAbrir={setAberto} />
                ))}
              </Box>
            </Box>
          ))}
        </Stack>
      )}

      <Lightbox item={aberto} onFechar={() => setAberto(null)} />
      {dialogoDeConfirmacao}

      <Snackbar
        open={Boolean(aviso)}
        autoHideDuration={3500}
        onClose={() => setAviso(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        <Alert
          severity={aviso?.tipo ?? 'success'}
          variant="filled"
          onClose={() => setAviso(null)}
          sx={{ borderRadius: 3, fontWeight: 600 }}
        >
          {aviso?.msg}
        </Alert>
      </Snackbar>
    </>
  );
}
