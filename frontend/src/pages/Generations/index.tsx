import DeleteOutlineRoundedIcon from '@mui/icons-material/DeleteOutlineRounded';
import DownloadRoundedIcon from '@mui/icons-material/DownloadRounded';
import RefreshRoundedIcon from '@mui/icons-material/RefreshRounded';
import {
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  Grid,
  IconButton,
  Tooltip,
  Typography,
} from '@mui/material';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { BrandLoader } from '@/components/ui/BrandLoader';
import { GeneratedMedia, videogenService } from '@/services/videogen.service';

const PENDING = ['queued', 'in_progress'];

const STATUS_LABEL: Record<GeneratedMedia['status'], string> = {
  queued: 'Na fila',
  in_progress: 'Gerando...',
  completed: 'Pronto',
  failed: 'Falhou',
  nsfw: 'Bloqueado',
  canceled: 'Cancelado',
};

function statusColor(status: GeneratedMedia['status']): {
  bg: string;
  color: string;
} {
  if (status === 'completed') return { bg: 'rgba(22,163,74,0.12)', color: '#16a34a' };
  if (PENDING.includes(status)) return { bg: 'rgba(0,194,187,0.12)', color: '#00c2bb' };
  return { bg: 'rgba(220,38,38,0.10)', color: '#dc2626' };
}

/** "12/08 às 19:45" — o card se identifica pela data, não pelo prompt. */
function quandoGerou(iso: string): string {
  const data = new Date(iso);
  const dia = data.toLocaleDateString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
  });
  const hora = data.toLocaleTimeString('pt-BR', {
    hour: '2-digit',
    minute: '2-digit',
  });
  return `${dia} às ${hora}`;
}

function MediaCard({
  item,
  onDelete,
}: {
  item: GeneratedMedia;
  onDelete: (id: string) => void;
}) {
  const badge = statusColor(item.status);
  const pending = PENDING.includes(item.status);
  const label =
    pending && item.kind === 'video'
      ? item.phase === 'image'
        ? 'Criando o frame base...'
        : 'Animando o vídeo...'
      : STATUS_LABEL[item.status];

  return (
    <Card
      sx={{
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        borderRadius: 3,
        overflow: 'hidden',
        transition: 'transform .15s ease, box-shadow .15s ease',
        '&:hover': {
          transform: 'translateY(-2px)',
          boxShadow: '0 10px 30px rgba(22,24,35,0.10)',
        },
      }}
    >
      <Box
        sx={{
          aspectRatio: item.aspectRatio === '9:16' ? '9 / 14' : '16 / 10',
          maxHeight: 320,
          bgcolor: 'rgba(22,24,35,0.04)',
          display: 'grid',
          placeItems: 'center',
          overflow: 'hidden',
        }}
      >
        {item.status === 'completed' && item.outputUrl ? (
          item.kind === 'video' ? (
            <Box
              component="video"
              src={item.outputUrl}
              controls
              loop
              muted
              playsInline
              sx={{ width: '100%', height: '100%', objectFit: 'cover' }}
            />
          ) : (
            <Box
              component="img"
              src={item.outputUrl}
              // O prompt NÃO aparece em lugar nenhum do card — nem no alt. Ele
              // é a receita interna da geração (direção de cena, restrições de
              // modelo), texto de máquina que só confunde e expõe o bastidor.
              alt="Imagem gerada por IA"
              sx={{ width: '100%', height: '100%', objectFit: 'cover' }}
            />
          )
        ) : item.imageUrl ? (
          <Box
            component="img"
            src={item.imageUrl}
            alt="frame base"
            sx={{ width: '100%', height: '100%', objectFit: 'cover', opacity: 0.6 }}
          />
        ) : pending ? (
          <BrandLoader minHeight={160} />
        ) : (
          <Typography variant="body2" color="text.secondary" px={2} textAlign="center">
            {item.error ?? 'A geração não foi concluída.'}
          </Typography>
        )}
      </Box>

      <CardContent sx={{ flexGrow: 1, pt: 1.5 }}>
        <Box display="flex" alignItems="center" gap={1} mb={1}>
          <Chip
            size="small"
            label={item.kind === 'video' ? 'Vídeo' : 'Imagem'}
            sx={{ fontWeight: 700 }}
          />
          <Chip
            size="small"
            label={label}
            sx={{ fontWeight: 700, bgcolor: badge.bg, color: badge.color }}
          />
          <Box ml="auto" display="flex" gap={0.5}>
            {item.status === 'completed' && item.outputUrl && (
              <Tooltip title="Abrir/baixar">
                <IconButton
                  size="small"
                  component="a"
                  href={item.outputUrl}
                  target="_blank"
                  rel="noreferrer"
                >
                  <DownloadRoundedIcon fontSize="small" />
                </IconButton>
              </Tooltip>
            )}
            <Tooltip title="Excluir">
              <IconButton size="small" onClick={() => onDelete(item.id)}>
                <DeleteOutlineRoundedIcon fontSize="small" />
              </IconButton>
            </Tooltip>
          </Box>
        </Box>
        <Typography variant="body2" color="text.secondary">
          {quandoGerou(item.createdAt)}
          {item.aspectRatio ? ` · ${item.aspectRatio}` : ''}
        </Typography>
      </CardContent>
    </Card>
  );
}

export function GenerationsPage() {
  const [items, setItems] = useState<GeneratedMedia[]>([]);
  const [loading, setLoading] = useState(true);
  const itemsRef = useRef(items);
  itemsRef.current = items;

  const load = useCallback(() => {
    videogenService
      .list()
      .then(setItems)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  useEffect(load, [load]);

  // Enquanto houver gerações pendentes, atualiza cada uma a cada 6s.
  useEffect(() => {
    const timer = setInterval(async () => {
      const pending = itemsRef.current.filter((i) => PENDING.includes(i.status));
      if (pending.length === 0) return;
      for (const item of pending) {
        try {
          const updated = await videogenService.refresh(item.id);
          setItems((prev) =>
            prev.map((p) => (p.id === updated.id ? updated : p)),
          );
        } catch (error) {
          console.error(error);
        }
      }
    }, 6000);
    return () => clearInterval(timer);
  }, []);

  async function handleDelete(id: string) {
    await videogenService.delete(id);
    setItems((prev) => prev.filter((p) => p.id !== id));
  }

  return (
    <>
      {/* O mesmo cabeçalho-vitrine do resto do produto: gradiente sutil da
          marca no fundo e no título, para a tela não parecer uma listagem
          administrativa do que é, na prática, a galeria do usuário. */}
      <Box
        sx={{
          position: 'relative',
          overflow: 'hidden',
          borderRadius: 4,
          p: { xs: 2.5, md: 3 },
          mb: 3,
          border: '1px solid',
          borderColor: 'divider',
          bgcolor: 'background.paper',
          backgroundImage:
            'radial-gradient(70% 130% at 100% 0%, rgba(254,44,85,0.10) 0%, transparent 60%),' +
            'radial-gradient(50% 100% at 0% 100%, rgba(0,194,187,0.07) 0%, transparent 60%)',
        }}
      >
        <Box
          display="flex"
          alignItems="center"
          justifyContent="space-between"
          gap={1}
          flexWrap="wrap"
        >
          <Box minWidth={0}>
            <Typography
              variant="h5"
              sx={{
                fontWeight: 800,
                background: 'linear-gradient(90deg, #fe2c55 0%, #00c2bb 100%)',
                backgroundClip: 'text',
                WebkitBackgroundClip: 'text',
                WebkitTextFillColor: 'transparent',
                width: 'fit-content',
              }}
            >
              Minhas Gerações
            </Typography>
            <Typography color="text.secondary" variant="body2" sx={{ mt: 0.5 }}>
              Imagens e vídeos criados por IA a partir do Cofre de Prompts.
            </Typography>
          </Box>
          <Button
            variant="outlined"
            startIcon={<RefreshRoundedIcon />}
            onClick={load}
            sx={{ flexShrink: 0 }}
          >
            Atualizar
          </Button>
        </Box>
      </Box>

      {loading ? (
        <BrandLoader label="Carregando gerações..." />
      ) : items.length === 0 ? (
        <Box
          sx={{
            textAlign: 'center',
            py: 8,
            px: 3,
            border: '1px dashed rgba(22,24,35,0.12)',
            borderRadius: 3,
          }}
        >
          <Typography variant="h6" mb={0.5}>
            Nenhuma geração ainda
          </Typography>
          <Typography color="text.secondary" mb={3}>
            Escolha um prompt no Cofre, preencha os campos e clique em "Gerar
            com IA".
          </Typography>
          <Button component={Link} to="/prompts" variant="contained">
            Abrir Cofre de Prompts
          </Button>
        </Box>
      ) : (
        <Grid container spacing={{ xs: 1.5, sm: 2.5 }}>
          {items.map((item) => (
            <Grid item xs={12} sm={6} md={4} key={item.id}>
              <MediaCard item={item} onDelete={handleDelete} />
            </Grid>
          ))}
        </Grid>
      )}
    </>
  );
}
