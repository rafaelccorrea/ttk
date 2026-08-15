import BookmarkRoundedIcon from '@mui/icons-material/BookmarkRounded';
import BookmarkBorderRoundedIcon from '@mui/icons-material/BookmarkBorderRounded';
import CloseRoundedIcon from '@mui/icons-material/CloseRounded';
import FavoriteRoundedIcon from '@mui/icons-material/FavoriteRounded';
import OpenInNewRoundedIcon from '@mui/icons-material/OpenInNewRounded';
import PauseRoundedIcon from '@mui/icons-material/PauseRounded';
import PlayArrowRoundedIcon from '@mui/icons-material/PlayArrowRounded';
import VisibilityRoundedIcon from '@mui/icons-material/VisibilityRounded';
import VolumeOffRoundedIcon from '@mui/icons-material/VolumeOffRounded';
import VolumeUpRoundedIcon from '@mui/icons-material/VolumeUpRounded';
import { Avatar, Backdrop, Box, Fade, IconButton, Stack, Typography } from '@mui/material';
import { useEffect, useRef, useState } from 'react';
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
  video: PlayableVideo | null;
  onClose: () => void;
  onToggleSave?: (id: string) => void;
}

// Player fullscreen estilo TikTok: vídeo 9:16 central, rail de ações à direita,
// legendas sobre o vídeo, barra de progresso clicável e tap para pausar.
export function TikTokPlayer({ video, onClose, onToggleSave }: TikTokPlayerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [playing, setPlaying] = useState(true);
  const [muted, setMuted] = useState(false);
  const [progress, setProgress] = useState(0);
  const [showPulse, setShowPulse] = useState<'play' | 'pause' | null>(null);

  useEffect(() => {
    setPlaying(true);
    setProgress(0);
  }, [video?.playbackUrl]);

  // Fecha com Esc.
  useEffect(() => {
    if (!video) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === ' ') {
        e.preventDefault();
        togglePlay();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [video]);

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

  function seek(event: React.MouseEvent<HTMLDivElement>) {
    const el = videoRef.current;
    if (!el || !el.duration) return;
    const rect = event.currentTarget.getBoundingClientRect();
    el.currentTime = ((event.clientX - rect.left) / rect.width) * el.duration;
  }

  if (!video) return null;

  return (
    <Backdrop
      open
      onClick={onClose}
      sx={{ zIndex: (t) => t.zIndex.modal + 1, bgcolor: 'rgba(8,9,13,0.92)', backdropFilter: 'blur(8px)' }}
    >
      <Fade in>
        <Box
          onClick={(e) => e.stopPropagation()}
          sx={{ display: 'flex', alignItems: 'center', gap: 2.5, maxHeight: '92vh' }}
        >
          {/* Vídeo */}
          <Box sx={{ position: 'relative', height: 'min(88vh, 780px)', aspectRatio: '9 / 16' }}>
            <Box
              component="video"
              ref={videoRef}
              src={video.playbackUrl ?? undefined}
              poster={video.thumbnailUrl ?? undefined}
              autoPlay
              playsInline
              loop
              muted={muted}
              onClick={togglePlay}
              onTimeUpdate={(e) => {
                const el = e.currentTarget;
                if (el.duration) setProgress(el.currentTime / el.duration);
              }}
              sx={{
                width: '100%',
                height: '100%',
                objectFit: 'cover',
                borderRadius: 4,
                bgcolor: '#000',
                cursor: 'pointer',
                boxShadow: '0 30px 90px rgba(0,0,0,0.6)',
              }}
            />

            {/* Pulso play/pause ao tocar */}
            {showPulse && (
              <Box
                sx={{
                  position: 'absolute', inset: 0, display: 'grid', placeItems: 'center',
                  pointerEvents: 'none',
                }}
              >
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

            {/* Gradiente + legenda inferior */}
            <Box
              sx={{
                position: 'absolute', left: 0, right: 0, bottom: 0, px: 2, pb: 2.5, pt: 6,
                borderRadius: 4,
                background: 'linear-gradient(180deg, transparent, rgba(0,0,0,0.72))',
                color: '#fff', pointerEvents: 'none',
              }}
            >
              <Typography fontWeight={800} fontSize={15}>
                @{video.creatorHandle}
              </Typography>
              <Typography fontSize={13.5} sx={{ opacity: 0.92, mt: 0.4 }} noWrap>
                {video.caption}
              </Typography>
              {typeof video.views === 'number' && (
                <Stack direction="row" spacing={0.6} alignItems="center" mt={0.6} sx={{ opacity: 0.8 }}>
                  <VisibilityRoundedIcon sx={{ fontSize: 15 }} />
                  <Typography fontSize={12.5}>{formatNumber(video.views)} views</Typography>
                  {video.category && <Typography fontSize={12.5}>· {video.category}</Typography>}
                </Stack>
              )}
            </Box>

            {/* Barra de progresso clicável */}
            <Box
              onClick={seek}
              sx={{
                position: 'absolute', left: 10, right: 10, bottom: 6, height: 14,
                display: 'flex', alignItems: 'center', cursor: 'pointer',
              }}
            >
              <Box sx={{ width: '100%', height: 3, borderRadius: 2, bgcolor: 'rgba(255,255,255,0.25)' }}>
                <Box sx={{ width: `${progress * 100}%`, height: '100%', borderRadius: 2, bgcolor: red, transition: 'width .1s linear' }} />
              </Box>
            </Box>

            {/* Mute */}
            <IconButton
              onClick={() => setMuted((m) => !m)}
              sx={{ position: 'absolute', top: 10, left: 10, color: '#fff', bgcolor: 'rgba(0,0,0,0.4)', '&:hover': { bgcolor: 'rgba(0,0,0,0.6)' } }}
              size="small"
            >
              {muted ? <VolumeOffRoundedIcon fontSize="small" /> : <VolumeUpRoundedIcon fontSize="small" />}
            </IconButton>
            {!playing && (
              <IconButton
                onClick={togglePlay}
                sx={{ position: 'absolute', top: 10, left: 52, color: '#fff', bgcolor: 'rgba(0,0,0,0.4)', '&:hover': { bgcolor: 'rgba(0,0,0,0.6)' } }}
                size="small"
              >
                <PlayArrowRoundedIcon fontSize="small" />
              </IconButton>
            )}
          </Box>

          {/* Rail de ações à direita, como no TikTok */}
          <Stack spacing={2.25} alignItems="center" sx={{ color: '#fff' }}>
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

            {(video.videoUrl || video.creatorHandle) && (
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
                <Typography fontSize={12} fontWeight={700}>TikTok</Typography>
              </Stack>
            )}
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
