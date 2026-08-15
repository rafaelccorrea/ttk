import BookmarkIcon from '@mui/icons-material/Bookmark';
import BookmarkBorderIcon from '@mui/icons-material/BookmarkBorder';
import PlayArrowRoundedIcon from '@mui/icons-material/PlayArrowRounded';
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
  Pagination,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from '@mui/material';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { videosService, ViralVideo } from '@/services/videos.service';
import { formatCurrency, formatNumber } from '@/utils/format';

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

function VideoCard({
  video,
  rank,
  onToggleSave,
  onShowTranscript,
}: {
  video: ViralVideo;
  rank: number;
  onToggleSave: (id: string) => void;
  onShowTranscript: (video: ViralVideo) => void;
}) {
  return (
    <Card
      sx={{
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        '&:hover': { transform: 'translateY(-2px)' },
      }}
    >
      {/* Topo "vertical" com proporção próxima de 9:16 (placeholder do vídeo). */}
      <Box
        sx={{
          position: 'relative',
          aspectRatio: '9 / 16',
          maxHeight: 260,
          background: gradientFor(video.category),
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          p: 1.25,
        }}
      >
        <Box display="flex" justifyContent="space-between" alignItems="flex-start">
          <Chip
            size="small"
            label={`#${rank}`}
            sx={{
              bgcolor: 'rgba(0,0,0,0.45)',
              color: '#fff',
              fontWeight: 800,
              backdropFilter: 'blur(4px)',
            }}
          />
          <IconButton
            size="small"
            onClick={() => onToggleSave(video.id)}
            aria-label="salvar vídeo"
            sx={{
              bgcolor: 'rgba(0,0,0,0.35)',
              color: video.isSaved ? '#ffd54f' : '#fff',
              '&:hover': { bgcolor: 'rgba(0,0,0,0.55)' },
            }}
          >
            {video.isSaved ? (
              <BookmarkIcon fontSize="small" />
            ) : (
              <BookmarkBorderIcon fontSize="small" />
            )}
          </IconButton>
        </Box>

        <PlayArrowRoundedIcon
          sx={{
            alignSelf: 'center',
            fontSize: 48,
            color: 'rgba(255,255,255,0.85)',
          }}
        />

        <Chip
          size="small"
          icon={<VisibilityOutlinedIcon sx={{ fontSize: 16, color: '#fff !important' }} />}
          label={`${formatNumber(video.views)} views`}
          sx={{
            alignSelf: 'flex-start',
            bgcolor: 'rgba(0,0,0,0.45)',
            color: '#fff',
            fontWeight: 700,
            backdropFilter: 'blur(4px)',
          }}
        />
      </Box>

      <CardContent
        sx={{ display: 'flex', flexDirection: 'column', flexGrow: 1, pt: 1.5 }}
      >
        <Typography
          sx={{
            fontWeight: 700,
            fontSize: 14,
            lineHeight: 1.4,
            display: '-webkit-box',
            WebkitLineClamp: 2,
            WebkitBoxOrient: 'vertical',
            overflow: 'hidden',
            minHeight: '2.8em',
          }}
        >
          {video.caption}
        </Typography>
        <Typography variant="caption" color="text.secondary" mt={0.5}>
          {video.creatorHandle} · {video.category}
        </Typography>

        <Box display="flex" gap={1} flexWrap="wrap" mt={1.5}>
          <Chip
            size="small"
            label={`Faturamento ~${formatCurrency(video.revenueEstimate)}`}
            sx={{
              fontWeight: 700,
              bgcolor: 'rgba(0,194,187,0.12)',
              color: 'secondary.main',
            }}
          />
          <Chip
            size="small"
            label={`♥ ${formatNumber(video.likes)}`}
            sx={{
              fontWeight: 700,
              bgcolor: 'rgba(254,44,85,0.10)',
              color: 'primary.main',
            }}
          />
        </Box>

        <Box
          display="flex"
          alignItems="center"
          gap={1}
          mt={1.5}
          pt={1.5}
          borderTop="1px solid rgba(22,24,35,0.08)"
        >
          {video.transcript && (
            <Button
              size="small"
              startIcon={<SubtitlesOutlinedIcon />}
              onClick={() => onShowTranscript(video)}
              sx={{ textTransform: 'none', fontWeight: 700 }}
            >
              Transcrição
            </Button>
          )}
          {video.productId && (
            <Button
              size="small"
              component={Link}
              to={`/produtos/${video.productId}`}
              sx={{ textTransform: 'none', fontWeight: 700, ml: 'auto' }}
            >
              Ver produto
            </Button>
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
  const [page, setPage] = useState(1);
  const [transcriptVideo, setTranscriptVideo] = useState<ViralVideo | null>(
    null,
  );

  useEffect(() => {
    // Debounce de 300ms para a busca.
    const timer = setTimeout(() => {
      videosService
        .list({
          search: search || undefined,
          saved: savedOnly || undefined,
          page,
          limit: PAGE_SIZE,
        })
        .then((data) => {
          setItems(data.items);
          setTotal(data.total);
        })
        .catch(console.error);
    }, 300);
    return () => clearTimeout(timer);
  }, [search, savedOnly, page]);

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

      <Box display="flex" gap={2} flexWrap="wrap" mb={3}>
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
        <TextField
          size="small"
          label="Buscar legenda ou criador"
          value={search}
          onChange={(e) => (setSearch(e.target.value), setPage(1))}
          sx={{ minWidth: 240 }}
        />
      </Box>

      <Grid container spacing={2.5}>
        {items.map((v, index) => (
          <Grid item xs={12} sm={6} md={4} lg={3} key={v.id}>
            <VideoCard
              video={v}
              rank={(page - 1) * PAGE_SIZE + index + 1}
              onToggleSave={toggleSave}
              onShowTranscript={setTranscriptVideo}
            />
          </Grid>
        ))}
      </Grid>

      {items.length === 0 && (
        <Typography color="text.secondary" textAlign="center" mt={6}>
          {savedOnly
            ? 'Você ainda não salvou nenhum vídeo.'
            : 'Nenhum vídeo encontrado.'}
        </Typography>
      )}

      <Box display="flex" justifyContent="center" mt={4}>
        <Pagination
          count={Math.max(1, Math.ceil(total / PAGE_SIZE))}
          page={page}
          onChange={(_e, value) => setPage(value)}
        />
      </Box>

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
