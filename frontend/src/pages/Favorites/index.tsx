import StarIcon from '@mui/icons-material/Star';
import StarBorderIcon from '@mui/icons-material/StarBorder';
import {
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  Grid,
  IconButton,
  Typography,
} from '@mui/material';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { BrandLoader } from '@/components/ui/BrandLoader';
import {
  FavoriteProduct,
  favoritesService,
} from '@/services/favorites.service';
import { formatCurrency } from '@/utils/format';

// Gradiente estável por categoria para o topo do card (sem imagens reais ainda).
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

function formatDate(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime())
    ? '—'
    : date.toLocaleDateString('pt-BR');
}

function FavoriteCard({
  product,
  onRemove,
}: {
  product: FavoriteProduct;
  onRemove: (id: string) => void;
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
      <Box
        sx={{
          height: 88,
          background: gradientFor(product.category),
          display: 'flex',
          alignItems: 'flex-start',
          justifyContent: 'flex-end',
          p: 1.25,
        }}
      >
        <IconButton
          size="small"
          onClick={() => onRemove(product.id)}
          aria-label="remover dos favoritos"
          sx={{
            bgcolor: 'rgba(0,0,0,0.35)',
            color: '#ffd54f',
            '&:hover': { bgcolor: 'rgba(0,0,0,0.55)' },
          }}
        >
          <StarIcon fontSize="small" />
        </IconButton>
      </Box>

      <CardContent
        sx={{ display: 'flex', flexDirection: 'column', flexGrow: 1, pt: 1.5 }}
      >
        <Typography
          component={Link}
          to={`/produtos/${product.id}`}
          sx={{
            color: 'inherit',
            textDecoration: 'none',
            fontWeight: 700,
            fontSize: 15,
            lineHeight: 1.35,
            display: '-webkit-box',
            WebkitLineClamp: 2,
            WebkitBoxOrient: 'vertical',
            overflow: 'hidden',
            minHeight: '2.7em',
            '&:hover': { color: 'primary.main' },
          }}
        >
          {product.title}
        </Typography>
        <Typography variant="caption" color="text.secondary" mt={0.5}>
          {product.storeName ?? '—'} · {product.category}
          {product.rating ? ` · ★ ${product.rating}` : ''}
        </Typography>

        <Box
          display="flex"
          justifyContent="space-between"
          alignItems="center"
          flexWrap="wrap"
          gap={1}
          mt={1.5}
        >
          <Typography variant="h6">{formatCurrency(product.price)}</Typography>
          {product.radarScore !== null && (
            <Chip
              size="small"
              label={`Radar ${product.radarScore}`}
              sx={{
                fontWeight: 700,
                bgcolor: 'rgba(0,194,187,0.12)',
                color: 'secondary.main',
              }}
            />
          )}
        </Box>

        <Box mt={1.5} pt={1.5} borderTop="1px solid rgba(22,24,35,0.08)">
          <Typography variant="caption" color="text.secondary">
            Favoritado em {formatDate(product.favoritedAt)}
          </Typography>
        </Box>
      </CardContent>
    </Card>
  );
}

export function FavoritesPage() {
  const [items, setItems] = useState<FavoriteProduct[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    favoritesService
      .list()
      .then(setItems)
      .catch(console.error)
      .finally(() => setIsLoading(false));
  }, []);

  async function removeFavorite(id: string) {
    try {
      await favoritesService.remove(id);
      setItems((prev) => prev.filter((p) => p.id !== id));
    } catch (error) {
      console.error(error);
    }
  }

  return (
    <>
      <Typography variant="h5">Meus Favoritos</Typography>
      <Typography color="text.secondary" mb={3}>
        Os produtos que você marcou com estrela para acompanhar de perto.
      </Typography>

      {isLoading ? (
        <BrandLoader label="Carregando favoritos..." />
      ) : items.length === 0 ? (
        <Box
          sx={{
            textAlign: 'center',
            py: 8,
            px: 3,
            border: '1px dashed rgba(22,24,35,0.08)',
            borderRadius: 3,
          }}
        >
          <StarBorderIcon
            sx={{ fontSize: 56, color: 'rgba(22,24,35,0.25)', mb: 1 }}
          />
          <Typography variant="h6" mb={0.5}>
            Você ainda não tem favoritos
          </Typography>
          <Typography color="text.secondary" mb={3}>
            Explore os produtos em alta e toque na estrela para salvá-los aqui.
          </Typography>
          <Button
            component={Link}
            to="/produtos"
            variant="contained"
            color="primary"
          >
            Explorar produtos
          </Button>
        </Box>
      ) : (
        <Grid container spacing={{ xs: 1.5, sm: 2.5 }}>
          {items.map((p) => (
            <Grid item xs={12} sm={6} md={4} key={p.id}>
              <FavoriteCard product={p} onRemove={removeFavorite} />
            </Grid>
          ))}
        </Grid>
      )}
    </>
  );
}
