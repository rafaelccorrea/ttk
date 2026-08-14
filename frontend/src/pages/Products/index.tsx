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
import {
  productsService,
  RankedProduct,
} from '@/services/products.service';
import { formatCurrency, formatNumber } from '@/utils/format';

const PAGE_SIZE = 24;

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
      <Typography variant="h5" gutterBottom>
        Produtos em alta
      </Typography>

      <Box display="flex" gap={2} flexWrap="wrap" mb={2}>
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
          label="Buscar"
          value={search}
          onChange={(e) => (setSearch(e.target.value), setPage(1))}
        />
      </Box>

      <Grid container spacing={2}>
        {items.map((p, index) => (
          <Grid item xs={12} sm={6} md={4} key={p.id}>
            <Card sx={{ height: '100%' }}>
              <CardContent>
                <Box display="flex" justifyContent="space-between">
                  <Chip
                    size="small"
                    label={`#${(page - 1) * PAGE_SIZE + index + 1}`}
                  />
                  <IconButton
                    size="small"
                    color="primary"
                    onClick={() => toggleFavorite(p.id)}
                    aria-label="favoritar"
                  >
                    {p.isFavorite ? <StarIcon /> : <StarBorderIcon />}
                  </IconButton>
                </Box>
                <Typography
                  component={Link}
                  to={`/produtos/${p.id}`}
                  sx={{
                    color: 'inherit',
                    textDecoration: 'none',
                    fontWeight: 600,
                    display: 'block',
                    my: 1,
                  }}
                >
                  {p.title}
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  {p.storeName ?? '—'} · {p.category}
                </Typography>
                <Box display="flex" justifyContent="space-between" mt={1}>
                  <Typography variant="h6">{formatCurrency(p.price)}</Typography>
                  {p.growthPct !== null && (
                    <Chip
                      size="small"
                      color={p.growthPct >= 0 ? 'success' : 'error'}
                      label={`${p.growthPct >= 0 ? '▲' : '▼'} ${Math.abs(p.growthPct)}%`}
                    />
                  )}
                </Box>
                <Typography variant="body2" color="text.secondary" mt={1}>
                  {formatNumber(p.salesPeriod)} vendas ·{' '}
                  {formatCurrency(p.revenuePeriod)} no período
                </Typography>
              </CardContent>
            </Card>
          </Grid>
        ))}
      </Grid>

      <Box display="flex" justifyContent="center" mt={3}>
        <Pagination
          count={Math.max(1, Math.ceil(total / PAGE_SIZE))}
          page={page}
          onChange={(_e, value) => setPage(value)}
        />
      </Box>
    </>
  );
}
