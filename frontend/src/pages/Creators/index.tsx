import {
  Avatar,
  Box,
  Chip,
  MenuItem,
  Pagination,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from '@mui/material';
import { useEffect, useState } from 'react';
import { creatorsService, RankedCreator } from '@/services/creators.service';
import { formatCurrency, formatNumber } from '@/utils/format';

const PAGE_SIZE = 25;

// Cor de avatar estável e determinística pelo handle.
const AVATAR_COLORS = [
  '#fe2c55',
  '#00c2bb',
  '#7c3aed',
  '#f59e0b',
  '#3b82f6',
  '#10b981',
  '#ec4899',
  '#ef4444',
];
function avatarColorFor(handle: string): string {
  let hash = 0;
  for (const ch of handle) hash = (hash * 31 + ch.charCodeAt(0)) % 997;
  return AVATAR_COLORS[hash % AVATAR_COLORS.length];
}

export function CreatorsPage() {
  const [items, setItems] = useState<RankedCreator[]>([]);
  const [total, setTotal] = useState(0);
  const [categories, setCategories] = useState<string[]>([]);
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('');
  const [sort, setSort] = useState<'gmv' | 'followers'>('gmv');
  const [page, setPage] = useState(1);

  useEffect(() => {
    creatorsService.categories().then(setCategories).catch(console.error);
  }, []);

  // Busca com debounce para não disparar requisição a cada tecla.
  useEffect(() => {
    const timer = setTimeout(() => {
      creatorsService
        .list({
          search: search || undefined,
          category: category || undefined,
          sort,
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
  }, [search, category, sort, page]);

  return (
    <>
      <Typography variant="h5">Top Criadores</Typography>
      <Typography color="text.secondary" mb={3}>
        Os criadores que mais vendem no TikTok Shop Brasil — ranqueados por
        GMV.
      </Typography>

      <Box display="flex" gap={2} flexWrap="wrap" mb={3}>
        <TextField
          size="small"
          label="Buscar criador ou @handle"
          value={search}
          onChange={(e) => (setSearch(e.target.value), setPage(1))}
          sx={{ minWidth: 220 }}
        />
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
        <ToggleButtonGroup
          size="small"
          exclusive
          value={sort}
          onChange={(_e, value) => value && (setSort(value), setPage(1))}
        >
          <ToggleButton value="gmv">GMV</ToggleButton>
          <ToggleButton value="followers">Seguidores</ToggleButton>
        </ToggleButtonGroup>
      </Box>

      <Table size="small">
        <TableHead>
          <TableRow>
            <TableCell width={64}>#</TableCell>
            <TableCell>Criador</TableCell>
            <TableCell>Categoria</TableCell>
            <TableCell align="right">Seguidores</TableCell>
            <TableCell align="right">Vendas (30d)</TableCell>
            <TableCell align="right">GMV (30d)</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {items.map((creator, index) => {
            const rank = (page - 1) * PAGE_SIZE + index + 1;
            return (
              <TableRow key={creator.id} hover>
                <TableCell>
                  {rank <= 3 ? (
                    <Chip
                      size="small"
                      color="primary"
                      label={`#${rank}`}
                      sx={{ fontWeight: 800 }}
                    />
                  ) : (
                    <Typography color="text.secondary" fontWeight={600}>
                      {rank}
                    </Typography>
                  )}
                </TableCell>
                <TableCell>
                  <Box display="flex" alignItems="center" gap={1.5}>
                    <Avatar
                      src={creator.avatarUrl ?? undefined}
                      sx={{
                        width: 36,
                        height: 36,
                        fontSize: 15,
                        fontWeight: 700,
                        bgcolor: avatarColorFor(creator.handle),
                        color: '#fff',
                      }}
                    >
                      {creator.name.charAt(0).toUpperCase()}
                    </Avatar>
                    <Box>
                      <Typography fontWeight={700} fontSize={14}>
                        {creator.name}
                      </Typography>
                      <Typography variant="caption" color="text.secondary">
                        @{creator.handle}
                      </Typography>
                    </Box>
                  </Box>
                </TableCell>
                <TableCell>
                  <Chip
                    size="small"
                    variant="outlined"
                    label={creator.category}
                    sx={{ borderColor: 'rgba(22,24,35,0.08)' }}
                  />
                </TableCell>
                <TableCell align="right">
                  <Typography fontWeight={600}>
                    {formatNumber(creator.followers)}
                  </Typography>
                </TableCell>
                <TableCell align="right">
                  {formatNumber(creator.salesPeriod)}
                </TableCell>
                <TableCell align="right">
                  <Typography fontWeight={800} color="primary.main">
                    {formatCurrency(creator.gmvPeriod)}
                  </Typography>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>

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
