import {
  Avatar,
  Box,
  Chip,
  Pagination,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from '@mui/material';
import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { BrandLoader } from '@/components/ui/BrandLoader';
import { FilterBar, SearchField } from '@/components/ui/Filters';
import { ScrollX } from '@/components/ui/ScrollX';
import { SearchableSelect } from '@/components/ui/SearchableSelect';
import { creatorsService, RankedCreator } from '@/services/creators.service';
import { formatCurrency, formatNumber } from '@/utils/format';
import { displayHandle, proxyImage, tiktokProfileUrl } from '@/utils/tiktok';

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
/** Handle numérico é user_id do fornecedor, não perfil navegável. */
function isRealHandle(handle: string): boolean {
  return Boolean(handle) && !/^d+$/.test(handle);
}

function avatarColorFor(handle: string): string {
  let hash = 0;
  for (const ch of handle) hash = (hash * 31 + ch.charCodeAt(0)) % 997;
  return AVATAR_COLORS[hash % AVATAR_COLORS.length];
}

export function CreatorsPage() {
  const [items, setItems] = useState<RankedCreator[]>([]);
  const [total, setTotal] = useState(0);
  const [categories, setCategories] = useState<string[]>([]);
  // Permite abrir a página já filtrada (ex.: card do Dashboard -> /criadores?search=handle).
  const [searchParams] = useSearchParams();
  const [search, setSearch] = useState(searchParams.get('search') ?? '');
  const [category, setCategory] = useState('');
  const [sort, setSort] = useState<'gmv' | 'followers'>('gmv');
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    creatorsService.categories().then(setCategories).catch(console.error);
  }, []);

  // Busca com debounce para não disparar requisição a cada tecla.
  useEffect(() => {
    setLoading(true);
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
        .catch(console.error)
        .finally(() => setLoading(false));
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

      <FilterBar>
        <SearchField
          value={search}
          onChange={(value) => (setSearch(value), setPage(1))}
          placeholder="Buscar criador ou @handle"
        />
        <SearchableSelect
          variant="pill"
          value={category}
          onChange={(value) => (setCategory(value), setPage(1))}
          emptyLabel="Todas as categorias"
          placeholder="Categoria"
          options={categories.map((c) => ({ value: c, label: c }))}
        />
        <ToggleButtonGroup
          size="small"
          exclusive
          value={sort}
          onChange={(_e, value) => value && (setSort(value), setPage(1))}
        >
          <ToggleButton value="gmv">GMV</ToggleButton>
          <ToggleButton value="followers">Seguidores</ToggleButton>
        </ToggleButtonGroup>
      </FilterBar>

      {loading && items.length === 0 && (
        <BrandLoader label="Carregando criadores..." />
      )}
      <ScrollX>
      <Table size="small" sx={{ minWidth: 720, opacity: loading ? 0.5 : 1, transition: 'opacity .2s' }}>
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
                    {/* Linka pelo @handle, não pela presença de avatar: criador real pode
                        estar sem foto (o CDN do fornecedor bloqueia hotlink) e ainda
                        assim ter perfil válido no TikTok. Sem src, o Avatar mostra a inicial. */}
                    <Avatar
                      component={isRealHandle(creator.handle) ? 'a' : 'div'}
                      href={isRealHandle(creator.handle) ? tiktokProfileUrl(creator.handle) : undefined}
                      target="_blank"
                      rel="noopener noreferrer"
                      src={proxyImage(creator.avatarUrl)}
                      sx={{
                        width: 36,
                        height: 36,
                        fontSize: 15,
                        fontWeight: 700,
                        bgcolor: avatarColorFor(creator.handle),
                        color: '#fff',
                        textDecoration: 'none',
                        transition: 'transform .15s ease',
                        '&:hover': { transform: 'scale(1.1)' },
                      }}
                    >
                      {creator.name.charAt(0).toUpperCase()}
                    </Avatar>
                    <Box>
                      <Typography fontWeight={700} fontSize={14}>
                        {creator.name}
                      </Typography>
                      <Typography
                        component={isRealHandle(creator.handle) ? 'a' : 'span'}
                        href={isRealHandle(creator.handle) ? tiktokProfileUrl(creator.handle) : undefined}
                        target="_blank"
                        rel="noopener noreferrer"
                        variant="caption"
                        sx={{
                          color: 'text.secondary',
                          textDecoration: 'none',
                          '&:hover': creator.avatarUrl
                            ? { color: 'primary.main', textDecoration: 'underline' }
                            : undefined,
                        }}
                      >
                        {displayHandle(creator.handle)}
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
      </ScrollX>

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
