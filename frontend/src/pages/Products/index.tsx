import StarIcon from '@mui/icons-material/Star';
import StarBorderIcon from '@mui/icons-material/StarBorder';
import {
  Box,
  Card,
  CardContent,
  Chip,
  Grid,
  IconButton,
  MenuItem,
  Pagination,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from '@mui/material';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { productsService, RankedProduct } from '@/services/products.service';
import { formatCurrency, formatNumber } from '@/utils/format';

const PAGE_SIZE = 24;

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

function ProductCard({
  product,
  rank,
  onToggleFavorite,
}: {
  product: RankedProduct;
  rank: number;
  onToggleFavorite: (id: string) => void;
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
          justifyContent: 'space-between',
          p: 1.25,
        }}
      >
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
          onClick={() => onToggleFavorite(product.id)}
          aria-label="favoritar"
          sx={{
            bgcolor: 'rgba(0,0,0,0.35)',
            color: product.isFavorite ? '#ffd54f' : '#fff',
            '&:hover': { bgcolor: 'rgba(0,0,0,0.55)' },
          }}
        >
          {product.isFavorite ? (
            <StarIcon fontSize="small" />
          ) : (
            <StarBorderIcon fontSize="small" />
          )}
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
          mt={1.5}
        >
          <Typography variant="h6">{formatCurrency(product.price)}</Typography>
          {product.growthPct !== null && (
            <Chip
              size="small"
              sx={{
                fontWeight: 700,
                bgcolor:
                  product.growthPct >= 0
                    ? 'rgba(74,222,128,0.14)'
                    : 'rgba(248,113,113,0.14)',
                color: product.growthPct >= 0 ? '#4ade80' : '#f87171',
              }}
              label={`${product.growthPct >= 0 ? '▲' : '▼'} ${Math.abs(product.growthPct)}%`}
            />
          )}
        </Box>

        <Box
          display="flex"
          gap={2}
          mt={1.5}
          pt={1.5}
          borderTop="1px solid rgba(22,24,35,0.08)"
        >
          <Box>
            <Typography variant="caption" color="text.secondary">
              Vendas
            </Typography>
            <Typography fontWeight={700}>
              {formatNumber(product.salesPeriod)}
            </Typography>
          </Box>
          <Box>
            <Typography variant="caption" color="text.secondary">
              Faturamento
            </Typography>
            <Typography fontWeight={700} color="primary.main">
              {formatCurrency(product.revenuePeriod)}
            </Typography>
          </Box>
          {product.radarScore !== null && (
            <Box ml="auto" textAlign="right">
              <Typography variant="caption" color="text.secondary">
                Radar
              </Typography>
              <Typography fontWeight={700} color="secondary.main">
                {product.radarScore}
              </Typography>
            </Box>
          )}
        </Box>
      </CardContent>
    </Card>
  );
}

export function ProductsPage() {
  const [items, setItems] = useState<RankedProduct[]>([]);
  const [total, setTotal] = useState(0);
  const [categories, setCategories] = useState<string[]>([]);
  const [period, setPeriod] = useState(30);
  const [category, setCategory] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);

  useEffect(() => {
    productsService.categories().then(setCategories).catch(console.error);
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => {
      productsService
        .rank({
          period,
          category: category || undefined,
          search: search || undefined,
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
  }, [period, category, search, page]);

  async function toggleFavorite(id: string) {
    const isFavorite = await productsService.toggleFavorite(id);
    setItems((prev) =>
      prev.map((p) => (p.id === id ? { ...p, isFavorite } : p)),
    );
  }

  return (
    <>
      <Typography variant="h5">Produtos em alta</Typography>
      <Typography color="text.secondary" mb={3}>
        Os produtos que mais venderam no período — ranqueados pelo volume real
        de vendas.
      </Typography>

      <Box display="flex" gap={2} flexWrap="wrap" mb={3}>
        <ToggleButtonGroup
          size="small"
          exclusive
          value={period}
          onChange={(_e, value) => value && (setPeriod(value), setPage(1))}
        >
          <ToggleButton value={7}>7 dias</ToggleButton>
          <ToggleButton value={30}>30 dias</ToggleButton>
          <ToggleButton value={90}>90 dias</ToggleButton>
        </ToggleButtonGroup>
        <TextField
          select
          size="small"
          label="Categoria"
          value={category}
          onChange={(e) => (setCategory(e.target.value), setPage(1))}
          sx={{ minWidth: 180 }}
        >
          <MenuItem value="">Todas</MenuItem>
          {categories.map((c) => (
            <MenuItem key={c} value={c}>
              {c}
            </MenuItem>
          ))}
        </TextField>
        <TextField
          size="small"
          label="Buscar produto ou loja"
          value={search}
          onChange={(e) => (setSearch(e.target.value), setPage(1))}
          sx={{ minWidth: 220 }}
        />
      </Box>

      <Grid container spacing={2.5}>
        {items.map((p, index) => (
          <Grid item xs={12} sm={6} md={4} key={p.id}>
            <ProductCard
              product={p}
              rank={(page - 1) * PAGE_SIZE + index + 1}
              onToggleFavorite={toggleFavorite}
            />
          </Grid>
        ))}
      </Grid>

      <Box display="flex" justifyContent="center" mt={4}>
        <Pagination
          count={Math.max(1, Math.ceil(total / PAGE_SIZE))}
          page={page}
          onChange={(_e, value) => setPage(value)}
        />
      </Box>
    </>
  );
}
