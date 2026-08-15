import BookmarkIcon from '@mui/icons-material/Bookmark';
import BookmarkBorderIcon from '@mui/icons-material/BookmarkBorder';
import OpenInNewRoundedIcon from '@mui/icons-material/OpenInNewRounded';
import PlayArrowRoundedIcon from '@mui/icons-material/PlayArrowRounded';
import ShoppingBagRoundedIcon from '@mui/icons-material/ShoppingBagRounded';
import SubtitlesOutlinedIcon from '@mui/icons-material/SubtitlesOutlined';
import VisibilityOutlinedIcon from '@mui/icons-material/VisibilityOutlined';
import {
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  Dialog,
  DialogContent,
  DialogTitle,
  Grid,
  IconButton,
  Skeleton,
  ToggleButton,
  ToggleButtonGroup,
  Tooltip,
  Typography,
} from '@mui/material';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useInfiniteScroll } from '@/hooks/useInfiniteScroll';
import { Link } from 'react-router-dom';
import { BrandLoader } from '@/components/ui/BrandLoader';
import { ImagePlaceholder } from '@/components/ui/ImagePlaceholder';
import { TikTokPlayer } from '@/components/ui/TikTokPlayer';
import { FilterBar, SearchField } from '@/components/ui/Filters';
import { SearchableSelect } from '@/components/ui/SearchableSelect';
import { HotBadge } from '@/components/ui/HotBadge';
import { videosService, VideoSection, ViralVideo } from '@/services/videos.service';
import { formatCurrency, formatNumber } from '@/utils/format';
import { displayHandle, proxyImage, tiktokProfileUrl } from '@/utils/tiktok';

const PAGE_SIZE = 24;

// Gradiente estável por categoria para o topo do card (mesmo padrão de Produtos).
const GRADIENTS = [
  'linear-gradient(135deg, #fe2c55 0%, #7c3aed 100%)',
  'linear-gradient(135deg, #06b6d4 0%, #3b82f6 100%)',
  'linear-gradient(135deg, #f59e0b 0%, #ef4444 100%)',
  'linear-gradient(135deg, #10b981 0%, #06b6d4 100%)',
  'linear-gradient(135deg, #8b5cf6 0%, #ec4899 100%)',
  'linear-gradient(135deg, #f43f5e 0%, #f59e0b 100%)',
];
function gradientFor(category: string): string {
  let hash = 0;
  for (const ch of category) hash = (hash * 31 + ch.charCodeAt(0)) % 997;
  return GRADIENTS[hash % GRADIENTS.length];
}

// Extrai o id numérico de uma URL pública do TikTok para o player embed.
export function tiktokEmbedId(videoUrl: string | null): string | null {
  const match = videoUrl?.match(/\/video\/(\d+)/);
  return match ? match[1] : null;
}

function VideoCard({
  video,
  rank,
  onToggleSave,
  onShowTranscript,
  onPlay,
}: {
  video: ViralVideo;
  rank: number;
  onToggleSave: (id: string) => void;
  onShowTranscript: (video: ViralVideo) => void;
  onPlay: (video: ViralVideo) => void;
}) {
  const thumb = video.thumbnailUrl ?? video.productImageUrl;
  // Thumb de vídeo já vem vertical (9/16): dá pra preencher o card inteiro com
  // `cover`. O fallback é foto de produto (quadrada) — aí `cover` cortaria o
  // produto, então mantemos `contain` com a cópia borrada preenchendo as bordas.
  const fillsCard = Boolean(video.thumbnailUrl);
  // Todo vídeo com id é tocável: o backend resolve o MP4 sob demanda e, se a
  // cota do fornecedor estiver esgotada, cai no embed oficial do TikTok.
  // Condicionar a `playbackUrl`/`videoUrl` deixava sem área de clique
  // justamente os vídeos que ainda não tinham @handle resolvido.
  const playable = Boolean(video.id);
  // "Destaque": pódio do ranking ou vídeo com audiência realmente viral.
  const isHot = rank <= 3 || video.views >= 1_000_000;
  // Skeleton no lugar da thumb até o `onLoad`.
  const [imgLoaded, setImgLoaded] = useState(false);
  // Botões flutuantes no canto direito, no estilo da barra de ações do TikTok.
  const railButton = {
    bgcolor: 'rgba(0,0,0,0.42)',
    color: '#fff',
    backdropFilter: 'blur(4px)',
    '&:hover': { bgcolor: 'rgba(0,0,0,0.62)' },
  } as const;

  return (
    <Card
      sx={{
        position: 'relative',
        // Formato "stories": card estreito e alto, thumb ocupando tudo.
        aspectRatio: '9 / 16',
        overflow: 'hidden',
        bgcolor: '#12131b',
        '&:hover': { transform: 'translateY(-2px)' },
      }}
    >
      {/* Fundo: gradiente da categoria quando não há thumb */}
      <Box
        sx={{
          position: 'absolute',
          inset: 0,
          background: thumb ? '#12131b' : gradientFor(video.category),
        }}
      />
      {!thumb && <ImagePlaceholder loading={false} />}
      {thumb && (
        <>
          {!imgLoaded && <ImagePlaceholder />}
          {/* Cópia desfocada preenche as bordas sem cortar a thumb real */}
          {!fillsCard && imgLoaded && (
            <Box
              component="img"
              src={proxyImage(thumb)}
              alt=""
              aria-hidden
              loading="lazy"
              sx={{
                position: 'absolute',
                inset: 0,
                width: '100%',
                height: '100%',
                objectFit: 'cover',
                filter: 'blur(24px) saturate(1.3)',
                transform: 'scale(1.2)',
                opacity: 0.5,
              }}
            />
          )}
          <Box
            component="img"
            src={proxyImage(thumb)}
            alt={video.caption}
            loading="lazy"
            // Imagem em cache termina de carregar ANTES de o React anexar o onLoad,

            // e aí o evento nunca dispara — o card ficava preso no placeholder com a

            // foto invisível por baixo. A ref confere o estado já na montagem.

            ref={(el: HTMLImageElement | null) => {

              if (el?.complete && el.naturalWidth > 0) setImgLoaded(true);

            }}

            onLoad={() => setImgLoaded(true)}
            onError={() => setImgLoaded(true)}
            sx={{
              position: 'absolute',
              inset: 0,
              width: '100%',
              height: '100%',
              objectFit: fillsCard ? 'cover' : 'contain',
              objectPosition: 'center top',
              opacity: imgLoaded ? 1 : 0,
              transition: 'transform .35s ease, opacity .3s ease',
              '.MuiCard-root:hover &': { transform: 'scale(1.05)' },
            }}
          />
        </>
      )}

      {/* Véu escuro para o texto sobreposto ficar legível */}
      <Box
        sx={{
          position: 'absolute',
          inset: 0,
          background:
            'linear-gradient(to top, rgba(0,0,0,0.9) 0%, rgba(0,0,0,0.65) 30%, rgba(0,0,0,0.05) 56%, rgba(0,0,0,0.35) 100%)',
        }}
      />

      {/* Toda a área da thumb dispara o player */}
      {playable && (
        <Box
          onClick={() => onPlay(video)}
          role="button"
          aria-label="assistir vídeo"
          sx={{ position: 'absolute', inset: 0, cursor: 'pointer' }}
        />
      )}

      {/* Topo: posição no ranking + salvar */}
      <Box
        sx={{
          position: 'absolute',
          top: 10,
          left: 10,
          right: 10,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          zIndex: 2,
        }}
      >
        <Box display="flex" alignItems="center" gap={0.5} minWidth={0} zIndex={3}>
          <Chip
            size="small"
            label={`#${rank}`}
            sx={{
              bgcolor: 'rgba(0,0,0,0.5)',
              color: '#fff',
              fontWeight: 800,
              backdropFilter: 'blur(4px)',
            }}
          />
          {isHot && (
            <HotBadge
              title={
                rank <= 3
                  ? `Top ${rank} entre os vídeos virais`
                  : `${formatNumber(video.views)} views`
              }
            />
          )}
        </Box>
        <IconButton
          size="small"
          onClick={() => onToggleSave(video.id)}
          aria-label="salvar vídeo"
          sx={{ ...railButton, color: video.isSaved ? '#ffd54f' : '#fff' }}
        >
          {video.isSaved ? (
            <BookmarkIcon fontSize="small" />
          ) : (
            <BookmarkBorderIcon fontSize="small" />
          )}
        </IconButton>
      </Box>

      {/* Play centralizado */}
      <Box
        sx={{
          position: 'absolute',
          inset: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          pointerEvents: 'none',
        }}
      >
        <PlayArrowRoundedIcon
          sx={{
            fontSize: 46,
            color: '#fff',
            filter: 'drop-shadow(0 2px 10px rgba(0,0,0,0.6))',
            opacity: playable ? 0.9 : 0.55,
            transition: 'transform .2s ease',
            '.MuiCard-root:hover &': playable ? { transform: 'scale(1.15)' } : undefined,
          }}
        />
      </Box>

      {/* Barra de ações lateral (estilo TikTok) */}
      <Box
        sx={{
          position: 'absolute',
          right: 8,
          bottom: 132,
          display: 'flex',
          flexDirection: 'column',
          gap: 0.75,
          zIndex: 3,
        }}
      >
        {video.transcript && (
          <Tooltip title="Ver transcrição" placement="left">
            <IconButton
              size="small"
              onClick={() => onShowTranscript(video)}
              aria-label="ver transcrição"
              sx={railButton}
            >
              <SubtitlesOutlinedIcon fontSize="small" />
            </IconButton>
          </Tooltip>
        )}
        {video.videoUrl && (
          <Tooltip title="Abrir no TikTok" placement="left">
            <IconButton
              size="small"
              component="a"
              href={video.videoUrl}
              target="_blank"
              rel="noopener noreferrer"
              aria-label="abrir no TikTok"
              sx={railButton}
            >
              <OpenInNewRoundedIcon fontSize="small" />
            </IconButton>
          </Tooltip>
        )}
        {video.productId && (
          <Tooltip title="Ver produto" placement="left">
            <IconButton
              size="small"
              component={Link}
              to={`/produtos/${video.productId}`}
              aria-label="ver produto"
              sx={railButton}
            >
              <ShoppingBagRoundedIcon fontSize="small" />
            </IconButton>
          </Tooltip>
        )}
      </Box>

      {/* Rodapé: informações sobrepostas */}
      <CardContent
        sx={{
          position: 'absolute',
          left: 0,
          right: 0,
          bottom: 0,
          zIndex: 2,
          color: '#fff',
          p: 1.5,
          '&:last-child': { pb: 1.5 },
        }}
      >
        <Typography
          sx={{
            fontWeight: 700,
            fontSize: 13.5,
            lineHeight: 1.3,
            display: '-webkit-box',
            WebkitLineClamp: 2,
            WebkitBoxOrient: 'vertical',
            overflow: 'hidden',
            textShadow: '0 1px 6px rgba(0,0,0,0.6)',
          }}
        >
          {video.caption}
        </Typography>
        <Typography
          variant="caption"
          noWrap
          sx={{ display: 'block', color: 'rgba(255,255,255,0.72)', mt: 0.25 }}
        >
          {/* Só linka o perfil quando temos o @handle de verdade. Enquanto o
              oEmbed não resolve o autor, guardamos o user_id numérico — e
              linkar isso levaria a um perfil inexistente. */}
          {!/^\d+$/.test(video.creatorHandle) ? (
            <Box
              component="a"
              href={tiktokProfileUrl(video.creatorHandle)}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e: React.MouseEvent) => e.stopPropagation()}
              sx={{
                color: 'inherit',
                textDecoration: 'none',
                position: 'relative',
                zIndex: 3,
                '&:hover': { color: '#fff', textDecoration: 'underline' },
              }}
            >
              {displayHandle(video.creatorHandle)}
            </Box>
          ) : (
            video.creatorHandle
          )}
          {' · '}
          {video.category}
        </Typography>

        <Box display="flex" gap={0.75} flexWrap="wrap" mt={1}>
          {/* Anúncio do Top Ads não expõe views: mostrar "0 views" passaria a
              impressão de vídeo sem audiência. Sem o número, não exibimos. */}
          {video.views > 0 && (
            <Chip
              size="small"
              icon={<VisibilityOutlinedIcon sx={{ fontSize: 14, color: '#fff !important' }} />}
              label={formatNumber(video.views)}
              sx={{
                height: 22,
                fontSize: 11.5,
                bgcolor: 'rgba(255,255,255,0.16)',
                color: '#fff',
                fontWeight: 700,
              }}
            />
          )}
          <Chip
            size="small"
            label={`♥ ${formatNumber(video.likes)}`}
            sx={{
              height: 22,
              fontSize: 11.5,
              fontWeight: 700,
              bgcolor: 'rgba(254,44,85,0.24)',
              color: '#ff8fa6',
            }}
          />
          {/* Só mostramos faturamento quando existe estimativa de verdade. */}
          {video.revenueEstimate > 0 && (
            <Chip
              size="small"
              label={`~${formatCurrency(video.revenueEstimate)}`}
              sx={{
                height: 22,
                fontSize: 11.5,
                fontWeight: 700,
                bgcolor: 'rgba(37,244,238,0.2)',
                color: '#25f4ee',
              }}
            />
          )}
        </Box>
      </CardContent>
    </Card>
  );
}

export function VideosPage() {
  const [items, setItems] = useState<ViralVideo[]>([]);
  const [total, setTotal] = useState(0);
  const [search, setSearch] = useState('');
  const [savedOnly, setSavedOnly] = useState(false);
  const [category, setCategory] = useState('');
  const [categories, setCategories] = useState<string[]>([]);
  const [sections, setSections] = useState<VideoSection[]>([]);
  const [sectionsMore, setSectionsMore] = useState(true);
  const [loadingSections, setLoadingSections] = useState(false);
  const [page, setPage] = useState(1);
  const [playingIndex, setPlayingIndex] = useState<number | null>(null);
  const [transcriptVideo, setTranscriptVideo] = useState<ViralVideo | null>(
    null,
  );
  const [loading, setLoading] = useState(true);

  // Vitrine por nicho só no estado limpo — com filtro, busca ou aba "Salvos"
  // o usuário quer varrer tudo, não navegar categorias.
  const showSections = !category && !search.trim() && !savedOnly && page === 1;

  /** Lista achatada usada pelo player: o índice precisa bater com a tela. */
  const feed = showSections ? sections.flatMap((s) => s.items) : items;

  // Categorias vêm do banco: só aparecem as que realmente têm vídeo.
  useEffect(() => {
    videosService.categories().then(setCategories).catch(console.error);
  }, []);

  // Vitrine em lotes de 4 categorias — o scroll pede as próximas.
  //
  // Cursor e trava ficam em `ref`, não em `state`: o scroll dispara várias
  // vezes por segundo e o `state` só chega no próximo render, o que deixava
  // passar chamadas duplicadas com o mesmo offset.
  const offsetRef = useRef(0);
  const carregandoRef = useRef(false);

  const carregarSecoes = useCallback(async (reiniciar: boolean) => {
    if (carregandoRef.current) return;
    carregandoRef.current = true;
    setLoadingSections(true);
    try {
      const offset = reiniciar ? 0 : offsetRef.current;
      const data = await videosService.sections(12, offset);
      offsetRef.current = offset + data.sections.length;
      setSections((prev) => {
        if (reiniciar) return data.sections;
        const vistos = new Set(prev.map((s) => s.category));
        return [...prev, ...data.sections.filter((s) => !vistos.has(s.category))];
      });
      setSectionsMore(data.hasMore);
    } catch (error) {
      console.error(error);
    } finally {
      carregandoRef.current = false;
      setLoadingSections(false);
    }
  }, []);

  useEffect(() => {
    if (!showSections) return;
    offsetRef.current = 0;
    setSections([]);
    setSectionsMore(true);
    void carregarSecoes(true);
  }, [showSections, carregarSecoes]);

  useInfiniteScroll({
    hasMore: showSections && sectionsMore,
    loading: loadingSections,
    onLoadMore: () => void carregarSecoes(false),
  });

  useEffect(() => {
    setLoading(true);
    // Debounce de 300ms para a busca.
    const timer = setTimeout(() => {
      videosService
        .list({
          search: search || undefined,
          saved: savedOnly || undefined,
          category: category || undefined,
          page,
          limit: PAGE_SIZE,
        })
        .then((data) => {
          // Página 1 substitui; as seguintes acumulam (scroll infinito).
          // O filtro por id evita repetir item quando duas buscas se cruzam.
          setItems((prev) => {
            if (page === 1) return data.items;
            const vistos = new Set(prev.map((v) => v.id));
            return [...prev, ...data.items.filter((v) => !vistos.has(v.id))];
          });
          setTotal(data.total);
        })
        .catch(console.error)
        .finally(() => setLoading(false));
    }, 300);
    return () => clearTimeout(timer);
  }, [search, savedOnly, category, page]);

  // Qualquer mudança de filtro volta para a página 1 — senão o acúmulo
  // misturaria resultados de buscas diferentes.
  useEffect(() => {
    setPage(1);
  }, [search, savedOnly, category]);

  // Scroll infinito também na grade filtrada: sem paginação por clique.
  useInfiniteScroll({
    hasMore: !showSections && items.length < total,
    loading,
    onLoadMore: () => setPage((p) => p + 1),
  });

  async function toggleSave(id: string) {
    const isSaved = await videosService.toggleSave(id);
    if (savedOnly && !isSaved) {
      setItems((prev) => prev.filter((v) => v.id !== id));
      setTotal((t) => Math.max(0, t - 1));
    } else {
      setItems((prev) => prev.map((v) => (v.id === id ? { ...v, isSaved } : v)));
    }
  }

  return (
    <>
      <Typography variant="h5">Vídeos que Vendem</Typography>
      <Typography color="text.secondary" mb={3}>
        Vídeos de shopping que estão viralizando no TikTok — com views e
        faturamento estimado para você se inspirar.
      </Typography>

      <FilterBar>
        <ToggleButtonGroup
          size="small"
          exclusive
          value={savedOnly ? 'saved' : 'trending'}
          onChange={(_e, value) => {
            if (value) {
              setSavedOnly(value === 'saved');
              setPage(1);
            }
          }}
        >
          <ToggleButton value="trending">Em alta</ToggleButton>
          <ToggleButton value="saved">Salvos</ToggleButton>
        </ToggleButtonGroup>
        <SearchableSelect
          variant="pill"
          value={category}
          onChange={(value) => (setCategory(value), setPage(1))}
          emptyLabel="Todas as categorias"
          placeholder="Categoria"
          options={categories.map((c) => ({ value: c, label: c }))}
        />
        <SearchField
          value={search}
          onChange={(value) => (setSearch(value), setPage(1))}
          placeholder="Buscar legenda ou criador"
        />
      </FilterBar>

      {loading && items.length === 0 && (
        <BrandLoader label="Carregando vídeos..." />
      )}
      {/* Vitrine por nicho no estado limpo; grade única assim que o usuário
          filtra. O player recebe SEMPRE a lista achatada `feed`, senão o
          índice de reprodução não bate com o que está na tela. */}
      {showSections ? (
        sections.map((section) => (
          <Box key={section.category} mb={4}>
            <Box
              display="flex"
              alignItems="baseline"
              justifyContent="space-between"
              mb={1.5}
            >
              <Typography variant="h6" fontWeight={800}>
                {section.category}
                <Typography
                  component="span"
                  color="text.secondary"
                  fontSize={13}
                  fontWeight={500}
                  ml={1}
                >
                  {section.total} vídeo{section.total === 1 ? '' : 's'}
                </Typography>
              </Typography>
              {section.total > section.items.length && (
                <Button
                  size="small"
                  onClick={() => (setCategory(section.category), setPage(1))}
                >
                  Ver todos
                </Button>
              )}
            </Box>
            <Grid container spacing={{ xs: 1.5, sm: 2.5 }}>
              {section.items.map((v, index) => (
                <Grid item xs={6} sm={4} md={3} lg={2} key={v.id}>
                  <VideoCard
                    video={v}
                    rank={index + 1}
                    onToggleSave={toggleSave}
                    onShowTranscript={setTranscriptVideo}
                    onPlay={(video) => {
                      const idx = feed.findIndex((it) => it.id === video.id);
                      if (idx >= 0) setPlayingIndex(idx);
                    }}
                  />
                </Grid>
              ))}
            </Grid>
          </Box>
        ))
      ) : (
        <Grid
          container
          spacing={{ xs: 1.5, sm: 2.5 }}
          sx={{ opacity: loading ? 0.5 : 1, transition: 'opacity .2s' }}
        >
          {items.map((v, index) => (
            <Grid item xs={6} sm={4} md={3} lg={2} key={v.id}>
              <VideoCard
                video={v}
                rank={(page - 1) * PAGE_SIZE + index + 1}
                onToggleSave={toggleSave}
                onShowTranscript={setTranscriptVideo}
                onPlay={(video) => {
                  // O MP4 é resolvido pelo player no momento do play, então
                  // filtrar por `playbackUrl` (sempre nulo) zerava a lista e o
                  // player nunca abria. Basta ter id.
                  const idx = feed.findIndex((it) => it.id === video.id);
                  if (idx >= 0) setPlayingIndex(idx);
                }}
              />
            </Grid>
          ))}
        </Grid>
      )}

      {/* O scroll infinito é controlado pelo hook, que observa a posição da
          página — não há sentinela no DOM. */}
      {showSections && loadingSections && sections.length > 0 && (
        <BrandLoader label="Carregando mais categorias..." minHeight={140} />
      )}

      {!loading && feed.length === 0 && (
        <Typography color="text.secondary" textAlign="center" mt={6}>
          {savedOnly
            ? 'Você ainda não salvou nenhum vídeo.'
            : 'Nenhum vídeo encontrado.'}
        </Typography>
      )}

      {/* Sem paginação por clique: o scroll traz a próxima página. */}
      {!showSections && loading && items.length > 0 && (
        <BrandLoader label="Carregando mais vídeos..." minHeight={120} />
      )}
      {!showSections && !loading && items.length >= total && total > 0 && (
        <Typography color="text.secondary" textAlign="center" fontSize={13} mt={4}>
          Você viu todos os {total} vídeos.
        </Typography>
      )}

      {/* Player fullscreen estilo TikTok */}
      <TikTokPlayer
        videos={feed}
        index={playingIndex}
        onIndexChange={setPlayingIndex}
        onClose={() => setPlayingIndex(null)}
        onToggleSave={toggleSave}
      />

      <Dialog
        open={Boolean(transcriptVideo)}
        onClose={() => setTranscriptVideo(null)}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle sx={{ fontWeight: 800 }}>
          Transcrição · {transcriptVideo?.creatorHandle}
        </DialogTitle>
        <DialogContent>
          <Typography color="text.secondary" variant="body2" mb={2}>
            {transcriptVideo?.caption}
          </Typography>
          <Typography sx={{ whiteSpace: 'pre-wrap' }}>
            {transcriptVideo?.transcript}
          </Typography>
        </DialogContent>
      </Dialog>
    </>
  );
}
