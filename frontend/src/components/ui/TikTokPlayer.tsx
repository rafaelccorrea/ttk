import BookmarkRoundedIcon from '@mui/icons-material/BookmarkRounded';
import BookmarkBorderRoundedIcon from '@mui/icons-material/BookmarkBorderRounded';
import CloseRoundedIcon from '@mui/icons-material/CloseRounded';
import FavoriteRoundedIcon from '@mui/icons-material/FavoriteRounded';
import KeyboardArrowDownRoundedIcon from '@mui/icons-material/KeyboardArrowDownRounded';
import KeyboardArrowUpRoundedIcon from '@mui/icons-material/KeyboardArrowUpRounded';
import OpenInNewRoundedIcon from '@mui/icons-material/OpenInNewRounded';
import PauseRoundedIcon from '@mui/icons-material/PauseRounded';
import PlayArrowRoundedIcon from '@mui/icons-material/PlayArrowRounded';
import VisibilityRoundedIcon from '@mui/icons-material/VisibilityRounded';
import VolumeOffRoundedIcon from '@mui/icons-material/VolumeOffRounded';
import VolumeUpRoundedIcon from '@mui/icons-material/VolumeUpRounded';
import { Avatar, Backdrop, Box, Button, Fade, IconButton, Stack, Typography } from '@mui/material';
import { useCallback, useEffect, useRef, useState } from 'react';
import { formatNumber } from '@/utils/format';
import { tiktokProfileUrl } from '@/utils/tiktok';

const red = '#fe2c55';

export interface PlayableVideo {
  playbackUrl: string | null;
  thumbnailUrl?: string | null;
  videoUrl?: string | null;
  caption: string;
  creatorHandle: string;
  views?: number;
  likes?: number;
  category?: string;
  isSaved?: boolean;
  id?: string;
}

interface TikTokPlayerProps {
  /** Feed de vídeos reproduzíveis; navegação por setas, scroll e auto-avanço. */
  videos: PlayableVideo[];
  /** Índice aberto; null fecha o player. */
  index: number | null;
  onClose: () => void;
  onIndexChange: (index: number) => void;
  onToggleSave?: (id: string) => void;
}

// Player fullscreen estilo TikTok: vídeo 9:16 central, rail de ações à direita,
// legenda sobre o vídeo, barra de progresso e navegação vertical entre vídeos.
export function TikTokPlayer({ videos, index, onClose, onIndexChange, onToggleSave }: TikTokPlayerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [playing, setPlaying] = useState(true);
  const [muted, setMuted] = useState(false);
  const [needsUnmute, setNeedsUnmute] = useState(false);
  const [progress, setProgress] = useState(0);
  const [showPulse, setShowPulse] = useState<'play' | 'pause' | null>(null);
  const wheelLock = useRef(0);

  const video = index === null ? null : videos[index] ?? null;
  const hasPrev = index !== null && index > 0;
  const hasNext = index !== null && index < videos.length - 1;

  const goTo = useCallback(
    (next: number) => {
      if (next >= 0 && next < videos.length) onIndexChange(next);
    },
    [videos.length, onIndexChange],
  );

  // Tenta tocar com som; se o navegador bloquear, cai para mudo + aviso.
  useEffect(() => {
    setProgress(0);
    setPlaying(true);
    const el = videoRef.current;
    if (!el || !video) return;
    el.muted = muted;
    const attempt = el.play();
    attempt?.catch(() => {
      el.muted = true;
      setMuted(true);
      setNeedsUnmute(true);
      void el.play().catch(() => setPlaying(false));
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [video?.playbackUrl]);

  useEffect(() => {
    if (index === null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      else if (e.key === 'ArrowDown') goTo(index + 1);
      else if (e.key === 'ArrowUp') goTo(index - 1);
      else if (e.key === ' ') {
        e.preventDefault();
        togglePlay();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index, videos.length]);

  function togglePlay() {
    const el = videoRef.current;
    if (!el) return;
    if (el.paused) {
      void el.play();
      setPlaying(true);
      setShowPulse('play');
    } else {
      el.pause();
      setPlaying(false);
      setShowPulse('pause');
    }
    setTimeout(() => setShowPulse(null), 500);
  }

  function unmute() {
    const el = videoRef.current;
    if (!el) return;
    el.muted = false;
    setMuted(false);
    setNeedsUnmute(false);
    void el.play();
  }

  function seek(event: React.MouseEvent<HTMLDivElement>) {
    event.stopPropagation();
    const el = videoRef.current;
    if (!el || !el.duration) return;
    const rect = event.currentTarget.getBoundingClientRect();
    el.currentTime = ((event.clientX - rect.left) / rect.width) * el.duration;
  }

  function onWheel(event: React.WheelEvent) {
    if (index === null) return;
    const now = Date.now();
    if (now - wheelLock.current < 500) return;
    if (Math.abs(event.deltaY) < 20) return;
    wheelLock.current = now;
    goTo(index + (event.deltaY > 0 ? 1 : -1));
  }

  if (!video || index === null) return null;

  return (
    <Backdrop
      open
      onClick={onClose}
      onWheel={onWheel}
      sx={{ zIndex: (t) => t.zIndex.modal + 1, bgcolor: 'rgba(8,9,13,0.92)', backdropFilter: 'blur(8px)' }}
    >
      <Fade in key={index}>
        <Box
          onClick={(e) => e.stopPropagation()}
          sx={{ display: 'flex', alignItems: 'center', gap: 2.5, maxHeight: '92vh' }}
        >
          {/* Vídeo (wrapper com overflow hidden segura a barra dentro do raio) */}
          <Box
            sx={{
              position: 'relative',
              height: 'min(88vh, 780px)',
              aspectRatio: '9 / 16',
              borderRadius: 4,
              overflow: 'hidden',
              bgcolor: '#000',
              boxShadow: '0 30px 90px rgba(0,0,0,0.6)',
            }}
          >
            <Box
              component="video"
              ref={videoRef}
              src={video.playbackUrl ?? undefined}
              poster={video.thumbnailUrl ?? undefined}
              autoPlay
              playsInline
              onClick={togglePlay}
              onEnded={() => (hasNext ? goTo(index + 1) : videoRef.current?.play())}
              onTimeUpdate={(e) => {
                const el = e.currentTarget;
                if (el.duration) setProgress(el.currentTime / el.duration);
              }}
              sx={{ width: '100%', height: '100%', objectFit: 'cover', cursor: 'pointer', display: 'block' }}
            />

            {/* Pulso play/pause ao tocar */}
            {showPulse && (
              <Box sx={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', pointerEvents: 'none' }}>
                <Box
                  sx={{
                    width: 74, height: 74, borderRadius: '50%', display: 'grid', placeItems: 'center',
                    bgcolor: 'rgba(0,0,0,0.55)', color: '#fff',
                    animation: 'ttpPulse .5s ease forwards',
                    '@keyframes ttpPulse': {
                      from: { transform: 'scale(0.7)', opacity: 1 },
                      to: { transform: 'scale(1.15)', opacity: 0 },
                    },
                  }}
                >
                  {showPulse === 'play' ? <PlayArrowRoundedIcon sx={{ fontSize: 44 }} /> : <PauseRoundedIcon sx={{ fontSize: 44 }} />}
                </Box>
              </Box>
            )}

            {/* Aviso para ativar o som quando o navegador bloqueou o autoplay com áudio */}
            {needsUnmute && (
              <Box sx={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', pointerEvents: 'none' }}>
                <Button
                  onClick={(e) => {
                    e.stopPropagation();
                    unmute();
                  }}
                  startIcon={<VolumeUpRoundedIcon />}
                  sx={{
                    pointerEvents: 'auto',
                    bgcolor: 'rgba(0,0,0,0.65)', color: '#fff', px: 2.5, py: 1,
                    borderRadius: 99, fontWeight: 700, backdropFilter: 'blur(6px)',
                    '&:hover': { bgcolor: red },
                  }}
                >
                  Ativar som
                </Button>
              </Box>
            )}

            {/* Gradiente + legenda inferior */}
            <Box
              sx={{
                position: 'absolute', left: 0, right: 0, bottom: 0, px: 2, pb: 3, pt: 6,
                background: 'linear-gradient(180deg, transparent, rgba(0,0,0,0.72))',
                color: '#fff', pointerEvents: 'none',
              }}
            >
              <Typography fontWeight={800} fontSize={15}>@{video.creatorHandle}</Typography>
              <Typography fontSize={13.5} sx={{ opacity: 0.92, mt: 0.4 }} noWrap>{video.caption}</Typography>
              {typeof video.views === 'number' && (
                <Stack direction="row" spacing={0.6} alignItems="center" mt={0.6} sx={{ opacity: 0.8 }}>
                  <VisibilityRoundedIcon sx={{ fontSize: 15 }} />
                  <Typography fontSize={12.5}>{formatNumber(video.views)} views</Typography>
                  {video.category && <Typography fontSize={12.5}>· {video.category}</Typography>}
                </Stack>
              )}
            </Box>

            {/* Barra de progresso contida dentro do vídeo */}
            <Box
              onClick={seek}
              sx={{
                position: 'absolute', left: 0, right: 0, bottom: 0, height: 16,
                display: 'flex', alignItems: 'flex-end', cursor: 'pointer', px: 1.5, pb: '6px',
              }}
            >
              <Box sx={{ width: '100%', height: 3, borderRadius: 2, bgcolor: 'rgba(255,255,255,0.25)', overflow: 'hidden' }}>
                <Box sx={{ width: `${progress * 100}%`, height: '100%', bgcolor: red, transition: 'width .1s linear' }} />
              </Box>
            </Box>

            {/* Mute + contador do feed */}
            <IconButton
              onClick={() => {
                const el = videoRef.current;
                if (!el) return;
                el.muted = !el.muted;
                setMuted(el.muted);
                setNeedsUnmute(false);
              }}
              sx={{ position: 'absolute', top: 10, left: 10, color: '#fff', bgcolor: 'rgba(0,0,0,0.4)', '&:hover': { bgcolor: 'rgba(0,0,0,0.6)' } }}
              size="small"
            >
              {muted ? <VolumeOffRoundedIcon fontSize="small" /> : <VolumeUpRoundedIcon fontSize="small" />}
            </IconButton>
            <Typography
              sx={{
                position: 'absolute', top: 16, right: 12, color: '#fff', fontSize: 12,
                fontWeight: 700, bgcolor: 'rgba(0,0,0,0.4)', px: 1, py: 0.25, borderRadius: 99,
              }}
            >
              {index + 1}/{videos.length}
            </Typography>
          </Box>

          {/* Rail de ações à direita */}
          <Stack spacing={2.25} alignItems="center" sx={{ color: '#fff' }}>
            <IconButton
              onClick={() => goTo(index - 1)}
              disabled={!hasPrev}
              sx={{ bgcolor: 'rgba(255,255,255,0.10)', color: '#fff', '&:hover': { bgcolor: 'rgba(255,255,255,0.22)' }, '&.Mui-disabled': { color: 'rgba(255,255,255,0.25)' } }}
            >
              <KeyboardArrowUpRoundedIcon />
            </IconButton>
            <IconButton
              onClick={() => goTo(index + 1)}
              disabled={!hasNext}
              sx={{ bgcolor: 'rgba(255,255,255,0.10)', color: '#fff', '&:hover': { bgcolor: 'rgba(255,255,255,0.22)' }, '&.Mui-disabled': { color: 'rgba(255,255,255,0.25)' } }}
            >
              <KeyboardArrowDownRoundedIcon />
            </IconButton>

            <Avatar
              component="a"
              href={tiktokProfileUrl(video.creatorHandle)}
              target="_blank"
              rel="noopener noreferrer"
              sx={{
                width: 48, height: 48, fontWeight: 800, textDecoration: 'none',
                background: `linear-gradient(135deg, ${red}, #ff7a9c)`,
                border: '2px solid #fff',
                transition: 'transform .15s ease',
                '&:hover': { transform: 'scale(1.1)' },
              }}
            >
              {video.creatorHandle.charAt(0).toUpperCase()}
            </Avatar>

            {typeof video.likes === 'number' && (
              <Stack alignItems="center" spacing={0.3}>
                <IconButton sx={{ bgcolor: 'rgba(255,255,255,0.10)', color: red, '&:hover': { bgcolor: 'rgba(255,255,255,0.2)' } }}>
                  <FavoriteRoundedIcon />
                </IconButton>
                <Typography fontSize={12} fontWeight={700}>{formatNumber(video.likes)}</Typography>
              </Stack>
            )}

            {onToggleSave && video.id && (
              <Stack alignItems="center" spacing={0.3}>
                <IconButton
                  onClick={() => onToggleSave(video.id!)}
                  sx={{ bgcolor: 'rgba(255,255,255,0.10)', color: video.isSaved ? '#ffd54f' : '#fff', '&:hover': { bgcolor: 'rgba(255,255,255,0.2)' } }}
                >
                  {video.isSaved ? <BookmarkRoundedIcon /> : <BookmarkBorderRoundedIcon />}
                </IconButton>
                <Typography fontSize={12} fontWeight={700}>salvar</Typography>
              </Stack>
            )}

            <Stack alignItems="center" spacing={0.3}>
              <IconButton
                component="a"
                href={video.videoUrl ?? tiktokProfileUrl(video.creatorHandle)}
                target="_blank"
                rel="noopener noreferrer"
                sx={{ bgcolor: 'rgba(255,255,255,0.10)', color: '#fff', '&:hover': { bgcolor: 'rgba(255,255,255,0.2)' } }}
              >
                <OpenInNewRoundedIcon />
              </IconButton>
              {/* Sem login o Creative Center não expõe o link do vídeo; o que temos é o perfil. */}
              <Typography fontSize={12} fontWeight={700}>{video.videoUrl ? 'Vídeo' : 'Perfil'}</Typography>
            </Stack>
          </Stack>

          {/* Fechar */}
          <IconButton
            onClick={onClose}
            sx={{
              position: 'fixed', top: 18, right: 22, color: '#fff',
              bgcolor: 'rgba(255,255,255,0.10)', '&:hover': { bgcolor: 'rgba(255,255,255,0.22)' },
            }}
          >
            <CloseRoundedIcon />
          </IconButton>
        </Box>
      </Fade>
    </Backdrop>
  );
}
