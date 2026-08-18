import FavoriteRoundedIcon from '@mui/icons-material/FavoriteRounded';
import OpenInNewRoundedIcon from '@mui/icons-material/OpenInNewRounded';
import VisibilityRoundedIcon from '@mui/icons-material/VisibilityRounded';
import {
  Alert,
  Box,
  Card,
  CardActionArea,
  Chip,
  Grid,
  Stack,
  Typography,
} from '@mui/material';
import { useEffect, useState } from 'react';
import { BrandLoader } from '@/components/ui/BrandLoader';
import { SmartImage } from '@/components/ui/SmartImage';
import { freeService, type FreeSnapshot } from '@/services/free.service';
import { ControlesTravados, FreeBanner, RodapeBloqueado } from './components';

/**
 * Vídeos, para quem ainda não assina (`docs/CONTA-FREE.md`).
 *
 * O card abre o TikTok, não o player interno: reproduzir aqui é banda e proxy
 * nossos, gastos por uma conta que não paga — e o link entrega a mesma prova
 * pelo custo de zero. Métricas em faixa, e sem receita estimada nem transcrição,
 * que são o que o assinante compra.
 */
export function FreeVideosPage() {
  const [snapshot, setSnapshot] = useState<FreeSnapshot | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    let ativo = true;
    freeService
      .sample()
      .then((s) => ativo && setSnapshot(s))
      .catch(
        () =>
          ativo &&
          setErro('Não foi possível carregar a amostra. Tente novamente em instantes.'),
      );
    return () => {
      ativo = false;
    };
  }, []);

  if (erro) return <Alert severity="error">{erro}</Alert>;
  if (!snapshot) return <BrandLoader label="Carregando a amostra..." />;

  return (
    <Box>
      <Typography variant="h5" fontWeight={800} mb={0.5}>
        Vídeos que vendem
      </Typography>
      <Typography color="text.secondary" mb={3}>
        Anúncios que estão performando — abra no TikTok para assistir.
      </Typography>

      <FreeBanner
        refreshAt={snapshot.refreshAt}
        descricao={`Você está vendo ${snapshot.videos.length} de ${snapshot.limits.videos} vídeos da amostra gratuita.`}
      />
      <ControlesTravados />

      <Grid container spacing={2}>
        {snapshot.videos.map((v) => (
          <Grid item xs={12} sm={6} md={4} lg={3} key={v.id}>
            <Card variant="outlined" sx={{ borderRadius: 3, height: '100%' }}>
              <CardActionArea
                component="a"
                href={v.videoUrl ?? undefined}
                target="_blank"
                rel="noopener noreferrer"
                disabled={!v.videoUrl}
                sx={{ height: '100%' }}
              >
                <Box sx={{ position: 'relative', pt: '133%' }}>
                  <Box sx={{ position: 'absolute', inset: 0 }}>
                    <SmartImage src={v.thumbnailUrl} alt={v.caption} tone="dark" />
                  </Box>
                  {v.videoUrl && (
                    <Chip
                      icon={<OpenInNewRoundedIcon />}
                      label="TikTok"
                      size="small"
                      sx={{ position: 'absolute', top: 8, right: 8, fontWeight: 700 }}
                    />
                  )}
                </Box>
                <Box sx={{ p: 1.75 }}>
                  <Chip label={v.category} size="small" sx={{ mb: 1 }} />
                  <Typography
                    fontWeight={700}
                    sx={{
                      display: '-webkit-box',
                      WebkitLineClamp: 2,
                      WebkitBoxOrient: 'vertical',
                      overflow: 'hidden',
                      minHeight: 44,
                    }}
                  >
                    {v.caption}
                  </Typography>
                  <Typography variant="body2" color="text.secondary" mt={0.5}>
                    {v.creatorHandle}
                  </Typography>
                  <Stack direction="row" spacing={2} mt={1}>
                    <Stack direction="row" spacing={0.5} alignItems="center">
                      <VisibilityRoundedIcon fontSize="small" color="disabled" />
                      <Typography variant="body2">{v.viewsRange}</Typography>
                    </Stack>
                    <Stack direction="row" spacing={0.5} alignItems="center">
                      <FavoriteRoundedIcon fontSize="small" color="disabled" />
                      <Typography variant="body2">{v.likesRange}</Typography>
                    </Stack>
                  </Stack>
                </Box>
              </CardActionArea>
            </Card>
          </Grid>
        ))}
      </Grid>

      <RodapeBloqueado tipo="vídeos" />
    </Box>
  );
}
