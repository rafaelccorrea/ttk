import ArrowDownwardRoundedIcon from '@mui/icons-material/ArrowDownwardRounded';
import ArrowUpwardRoundedIcon from '@mui/icons-material/ArrowUpwardRounded';
import TuneRoundedIcon from '@mui/icons-material/TuneRounded';
import StarIcon from '@mui/icons-material/Star';
import StarBorderIcon from '@mui/icons-material/StarBorder';
import {
  Badge,
  Box,
  Button,
  Card,
  Collapse,
  FormControlLabel,
  MenuItem,
  Switch,
  TextField,
  Tooltip,
  CardActionArea,
  CardContent,
  Chip,
  Grid,
  IconButton,
  Skeleton,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from '@mui/material';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useInfiniteScroll } from '@/hooks/useInfiniteScroll';
import { Link } from 'react-router-dom';
import { BrandLoader } from '@/components/ui/BrandLoader';
import { ImagePlaceholder } from '@/components/ui/ImagePlaceholder';
import { FilterBar, SearchField, SelectField } from '@/components/ui/Filters';
import { HotBadge } from '@/components/ui/HotBadge';
import {
  ProductFilterOptions,
  ProductSection,
  ProductSort,
  productsService,
  RankedProduct,
} from '@/services/products.service';
import { formatCurrency, formatNumber } from '@/utils/format';
import { proxyImage } from '@/utils/tiktok';

const PAGE_SIZE = 24;
const cyan = '#25f4ee';

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
  const growth = product.growthPct;
  // "Destaque": pódio do ranking ou crescimento forte no período.
  const isHot = rank <= 3 || (growth !== null && growth >= 50);
  // Skeleton no lugar da foto até o `onLoad` — evita o card piscar preto
  // enquanto a imagem vem do proxy.
  const [imgLoaded, setImgLoaded] = useState(false);
  return (
    <Card
      sx={{
        position: 'relative',
        // Formato "stories": card estreito e alto, foto ocupando tudo.
        aspectRatio: '9 / 16',
        overflow: 'hidden',
        cursor: 'pointer',
        bgcolor: '#12131b',
        '&:hover': { transform: 'translateY(-3px)' },
      }}
    >
      {/* Card inteiro navega para o detalhe (UX óbvia) */}
      <CardActionArea
        component={Link}
        to={`/produtos/${product.id}`}
        sx={{ height: '100%', display: 'block' }}
      >
        {/* Fundo: gradiente da categoria quando não há foto */}
        <Box
          sx={{
            position: 'absolute',
            inset: 0,
            background: product.imageUrl ? '#12131b' : gradientFor(product.category),
          }}
        />
        {!product.imageUrl && <ImagePlaceholder loading={false} />}
        {product.imageUrl && (
          <>
            {/* A foto preenche o card inteiro. Foto de produto costuma vir
                quadrada com margem sobrando nas bordas, então o corte do
                `cover` come a margem, não o produto — e some com as faixas
                borradas que desperdiçavam metade do card. */}
            {!imgLoaded && <ImagePlaceholder />}
            <Box
              component="img"
              src={proxyImage(product.imageUrl)}
              alt={product.title}
              loading="lazy"
              onLoad={() => setImgLoaded(true)}
              onError={() => setImgLoaded(true)}
              sx={{
                position: 'absolute',
                inset: 0,
                width: '100%',
                height: '100%',
                objectFit: 'cover',
                objectPosition: 'center 40%',
                opacity: imgLoaded ? 1 : 0,
                transition: 'transform .35s ease, opacity .3s ease',
                '.MuiCard-root:hover &': { transform: 'scale(1.05)' },
              }}
            />
          </>
        )}

        {/* Véu escuro só na base, para o texto sobreposto ficar legível */}
        <Box
          sx={{
            position: 'absolute',
            inset: 0,
            background:
              'linear-gradient(to top, rgba(0,0,0,0.88) 0%, rgba(0,0,0,0.62) 26%, rgba(0,0,0,0.05) 52%, rgba(0,0,0,0.35) 100%)',
          }}
        />

        {/* Topo: posição no ranking + favorito */}
        <Box
          sx={{
            position: 'absolute',
            top: 10,
            left: 10,
            right: 10,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            zIndex: 2,
          }}
        >
          <Box display="flex" alignItems="center" gap={0.5} minWidth={0}>
            <Chip
              size="small"
              label={`#${rank}`}
              sx={{
                bgcolor: 'rgba(0,0,0,0.5)',
                color: '#fff',
                fontWeight: 800,
                backdropFilter: 'blur(4px)',
              }}
            />
            {isHot && (
              <HotBadge
                title={
                  rank <= 3
                    ? `Top ${rank} em vendas no período`
                    : `Crescimento de ${growth}% no período`
                }
              />
            )}
          </Box>
          <IconButton
            size="small"
            onClick={(e) => {
              // Impede que o clique no favorito navegue para o detalhe.
              e.preventDefault();
              e.stopPropagation();
              onToggleFavorite(product.id);
            }}
            aria-label="favoritar"
            sx={{
              bgcolor: 'rgba(0,0,0,0.4)',
              color: product.isFavorite ? '#ffd54f' : '#fff',
              '&:hover': { bgcolor: 'rgba(0,0,0,0.6)' },
            }}
          >
            {product.isFavorite ? (
              <StarIcon fontSize="small" />
            ) : (
              <StarBorderIcon fontSize="small" />
            )}
          </IconButton>
        </Box>

        {/* Rodapé: informações sobrepostas à foto */}
        <CardContent
          sx={{
            position: 'absolute',
            left: 0,
            right: 0,
            bottom: 0,
            zIndex: 2,
            color: '#fff',
            p: 1.5,
            '&:last-child': { pb: 1.5 },
          }}
        >
          <Typography
            sx={{
              fontWeight: 700,
              fontSize: 14,
              lineHeight: 1.3,
              display: '-webkit-box',
              WebkitLineClamp: 2,
              WebkitBoxOrient: 'vertical',
              overflow: 'hidden',
              textShadow: '0 1px 6px rgba(0,0,0,0.6)',
            }}
          >
            {product.title}
          </Typography>
          <Typography
            variant="caption"
            noWrap
            sx={{ display: 'block', color: 'rgba(255,255,255,0.72)', mt: 0.25 }}
          >
            {product.storeName ?? '—'} · {product.category}
            {product.rating ? ` · ★ ${product.rating}` : ''}
          </Typography>

          <Box display="flex" alignItems="center" gap={0.75} mt={1}>
            <Typography fontWeight={800} fontSize={17}>
              {formatCurrency(product.price)}
            </Typography>
            {growth !== null && (
              <Chip
                size="small"
                sx={{
                  height: 20,
                  fontSize: 11,
                  fontWeight: 700,
                  bgcolor: growth >= 0 ? 'rgba(74,222,128,0.2)' : 'rgba(248,113,113,0.2)',
                  color: growth >= 0 ? '#4ade80' : '#f87171',
                }}
                label={`${growth >= 0 ? '▲' : '▼'} ${Math.abs(growth)}%`}
              />
            )}
          </Box>

          <Box
            display="flex"
            gap={1.5}
            mt={1}
            pt={1}
            borderTop="1px solid rgba(255,255,255,0.16)"
          >
            <Box minWidth={0}>
              <Typography variant="caption" sx={{ color: 'rgba(255,255,255,0.6)' }}>
                Vendas
              </Typography>
              <Typography fontWeight={700} fontSize={13.5}>
                {formatNumber(product.salesPeriod)}
              </Typography>
            </Box>
            <Box minWidth={0}>
              <Typography variant="caption" sx={{ color: 'rgba(255,255,255,0.6)' }}>
                Faturamento
              </Typography>
              <Typography fontWeight={700} fontSize={13.5} noWrap sx={{ color: '#ff6b8a' }}>
                {formatCurrency(product.revenuePeriod)}
              </Typography>
            </Box>
            {product.radarScore !== null && (
              <Box ml="auto" textAlign="right">
                <Typography variant="caption" sx={{ color: 'rgba(255,255,255,0.6)' }}>
                  Radar
                </Typography>
                <Typography fontWeight={700} fontSize={13.5} sx={{ color: cyan }}>
                  {product.radarScore}
                </Typography>
              </Box>
            )}
          </Box>
        </CardContent>
      </CardActionArea>
    </Card>
  );
}

/** Estado dos filtros avançados — tudo opcional, vazio = sem filtro. */
interface AdvancedFilters {
  store: string;
  minPrice: string;
  maxPrice: string;
  minSales: string;
  minGrowth: string;
  minRating: string;
  onlyFavorites: boolean;
  withImage: boolean;
}

const EMPTY_ADVANCED: AdvancedFilters = {
  store: '',
  minPrice: '',
  maxPrice: '',
  minSales: '',
  minGrowth: '',
  minRating: '',
  onlyFavorites: false,
  withImage: false,
};

const num = (value: string): number | undefined => {
  const parsed = Number(value);
  return value.trim() !== '' && Number.isFinite(parsed) ? parsed : undefined;
};

export function ProductsPage() {
  const [items, setItems] = useState<RankedProduct[]>([]);
  const [total, setTotal] = useState(0);
  const [options, setOptions] = useState<ProductFilterOptions | null>(null);
  const [period, setPeriod] = useState(30);
  const [category, setCategory] = useState('');
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<ProductSort>('sales');
  const [order, setOrder] = useState<'asc' | 'desc'>('desc');
  const [pageSize, setPageSize] = useState(PAGE_SIZE);
  const [advanced, setAdvanced] = useState<AdvancedFilters>(EMPTY_ADVANCED);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [sections, setSections] = useState<ProductSection[]>([]);
  const [sectionsMore, setSectionsMore] = useState(true);
  const [loadingSections, setLoadingSections] = useState(false);

  const categories = options?.categories ?? [];

  // Qualquer mudança de filtro volta para a primeira página, senão o usuário
  // fica numa página que não existe mais no novo resultado.
  const resetPage = () => setPage(1);

  const activeCount =
    Object.entries(advanced).filter(([, v]) =>
      typeof v === 'boolean' ? v : String(v).trim() !== '',
    ).length + (category ? 1 : 0);

  // Modo vitrine só vale no estado limpo: qualquer filtro, busca ou ordenação
  // significa que o usuário quer comparar o catálogo inteiro, não navegar nichos.
  const showSections =
    !category &&
    !search.trim() &&
    activeCount === 0 &&
    sort === 'sales' &&
    page === 1;

  // Vitrine em lotes de 4 categorias — o scroll pede as próximas.
  //
  // O cursor e a trava ficam em `ref`, não em `state`: o scroll dispara várias
  // vezes por segundo e o `state` só chega no próximo render, o que deixava
  // passar chamadas duplicadas com o mesmo offset.
  const offsetRef = useRef(0);
  const carregandoRef = useRef(false);

  const carregarSecoes = useCallback(
    async (reiniciar: boolean) => {
      if (carregandoRef.current) return;
      carregandoRef.current = true;
      setLoadingSections(true);
      try {
        const offset = reiniciar ? 0 : offsetRef.current;
        const data = await productsService.sections(period, 12, offset);
        offsetRef.current = offset + data.sections.length;
        setSections((prev) => {
          if (reiniciar) return data.sections;
          const vistos = new Set(prev.map((s) => s.category));
          return [...prev, ...data.sections.filter((s) => !vistos.has(s.category))];
        });
        setSectionsMore(data.hasMore);
      } catch (error) {
        console.error(error);
      } finally {
        carregandoRef.current = false;
        setLoadingSections(false);
      }
    },
    [period],
  );

  useEffect(() => {
    if (!showSections) return;
    offsetRef.current = 0;
    setSections([]);
    setSectionsMore(true);
    void carregarSecoes(true);
  }, [showSections, carregarSecoes]);

  useInfiniteScroll({
    hasMore: showSections && sectionsMore,
    loading: loadingSections,
    onLoadMore: () => void carregarSecoes(false),
  });

  useEffect(() => {
    productsService.filterOptions().then(setOptions).catch(console.error);
  }, []);

  useEffect(() => {
    setLoading(true);
    const timer = setTimeout(() => {
      productsService
        .rank({
          period,
          category: category || undefined,
          search: search || undefined,
          store: advanced.store || undefined,
          minPrice: num(advanced.minPrice),
          maxPrice: num(advanced.maxPrice),
          minSales: num(advanced.minSales),
          minGrowth: num(advanced.minGrowth),
          minRating: num(advanced.minRating),
          onlyFavorites: advanced.onlyFavorites || undefined,
          withImage: advanced.withImage || undefined,
          sort,
          order,
          page,
          limit: pageSize,
        })
        .then((data) => {
          // Página 1 substitui; as seguintes acumulam (scroll infinito).
          // O filtro por id evita repetir item quando duas buscas se cruzam.
          setItems((prev) => {
            if (page === 1) return data.items;
            const vistos = new Set(prev.map((p) => p.id));
            return [...prev, ...data.items.filter((p) => !vistos.has(p.id))];
          });
          setTotal(data.total);
        })
        .catch(console.error)
        .finally(() => setLoading(false));
    }, 300);
    return () => clearTimeout(timer);
  }, [period, category, search, sort, order, page, pageSize, advanced]);

  // Qualquer mudança de filtro volta para a página 1 — senão o acúmulo
  // misturaria resultados de buscas diferentes.
  useEffect(() => {
    setPage(1);
  }, [period, category, search, sort, order, advanced]);

  // Scroll infinito também na grade filtrada: sem paginação por clique.
  useInfiniteScroll({
    hasMore: !showSections && items.length < total,
    loading,
    onLoadMore: () => setPage((p) => p + 1),
  });

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

      <FilterBar>
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
        <SelectField
          value={category}
          onChange={(value) => (setCategory(value), setPage(1))}
          options={[
            { value: '', label: 'Todas as categorias' },
            ...categories.map((c) => ({ value: c, label: c })),
          ]}
        />
        <SearchField
          value={search}
          onChange={(value) => (setSearch(value), resetPage())}
          placeholder="Buscar produto ou loja"
        />
        <SelectField
          value={sort}
          onChange={(value) => (setSort(value as ProductSort), resetPage())}
          options={
            options?.sorts?.map((s) => ({ value: s.value, label: s.label })) ?? [
              { value: 'sales', label: 'Mais vendidos' },
            ]
          }
        />
        <Tooltip title={order === 'desc' ? 'Maior para menor' : 'Menor para maior'}>
          <IconButton
            size="small"
            onClick={() => (setOrder(order === 'desc' ? 'asc' : 'desc'), resetPage())}
            aria-label="inverter ordem"
          >
            {order === 'desc' ? <ArrowDownwardRoundedIcon fontSize="small" /> : <ArrowUpwardRoundedIcon fontSize="small" />}
          </IconButton>
        </Tooltip>
        <Badge badgeContent={activeCount} color="primary" overlap="circular">
          <Button
            size="small"
            variant={showAdvanced ? 'contained' : 'outlined'}
            startIcon={<TuneRoundedIcon />}
            onClick={() => setShowAdvanced((v) => !v)}
          >
            Filtros
          </Button>
        </Badge>
      </FilterBar>

      <Collapse in={showAdvanced}>
        <Card variant="outlined" sx={{ mb: 2.5, borderRadius: 3 }}>
          <CardContent>
            <Grid container spacing={2} alignItems="center">
              <Grid item xs={12} sm={6} md={3}>
                <TextField
                  select
                  fullWidth
                  size="small"
                  label="Loja"
                  value={advanced.store}
                  onChange={(e) => (setAdvanced({ ...advanced, store: e.target.value }), resetPage())}
                >
                  <MenuItem value="">Todas as lojas</MenuItem>
                  {(options?.stores ?? []).map((s) => (
                    <MenuItem key={s} value={s}>{s}</MenuItem>
                  ))}
                </TextField>
              </Grid>
              <Grid item xs={6} sm={3} md={1.5}>
                <TextField
                  fullWidth size="small" type="number" label="Preço mín."
                  placeholder={String(options?.priceRange.min ?? 0)}
                  value={advanced.minPrice}
                  onChange={(e) => (setAdvanced({ ...advanced, minPrice: e.target.value }), resetPage())}
                />
              </Grid>
              <Grid item xs={6} sm={3} md={1.5}>
                <TextField
                  fullWidth size="small" type="number" label="Preço máx."
                  placeholder={String(options?.priceRange.max ?? 0)}
                  value={advanced.maxPrice}
                  onChange={(e) => (setAdvanced({ ...advanced, maxPrice: e.target.value }), resetPage())}
                />
              </Grid>
              <Grid item xs={6} sm={4} md={2}>
                <TextField
                  fullWidth size="small" type="number" label="Vendas mín."
                  value={advanced.minSales}
                  onChange={(e) => (setAdvanced({ ...advanced, minSales: e.target.value }), resetPage())}
                />
              </Grid>
              <Grid item xs={6} sm={4} md={2}>
                <TextField
                  fullWidth size="small" type="number" label="Crescimento mín. (%)"
                  value={advanced.minGrowth}
                  onChange={(e) => (setAdvanced({ ...advanced, minGrowth: e.target.value }), resetPage())}
                />
              </Grid>
              <Grid item xs={6} sm={4} md={2}>
                <TextField
                  fullWidth size="small" type="number" label="Nota mín."
                  inputProps={{ min: 0, max: 5, step: 0.1 }}
                  value={advanced.minRating}
                  onChange={(e) => (setAdvanced({ ...advanced, minRating: e.target.value }), resetPage())}
                />
              </Grid>
              <Grid item xs={12} md={6}>
                <FormControlLabel
                  control={
                    <Switch
                      checked={advanced.onlyFavorites}
                      onChange={(e) => (setAdvanced({ ...advanced, onlyFavorites: e.target.checked }), resetPage())}
                    />
                  }
                  label="Só favoritos"
                />
                <FormControlLabel
                  control={
                    <Switch
                      checked={advanced.withImage}
                      onChange={(e) => (setAdvanced({ ...advanced, withImage: e.target.checked }), resetPage())}
                    />
                  }
                  label="Só com foto"
                />
              </Grid>
              <Grid item xs={12} md={6} sx={{ textAlign: { md: 'right' } }}>
                <TextField
                  select size="small" label="Por página" sx={{ minWidth: 130, mr: 1 }}
                  value={pageSize}
                  onChange={(e) => (setPageSize(Number(e.target.value)), resetPage())}
                >
                  {[24, 48, 100].map((n) => (
                    <MenuItem key={n} value={n}>{n} itens</MenuItem>
                  ))}
                </TextField>
                <Button
                  size="small"
                  onClick={() => (setAdvanced(EMPTY_ADVANCED), setCategory(''), resetPage())}
                >
                  Limpar filtros
                </Button>
              </Grid>
            </Grid>
          </CardContent>
        </Card>
      </Collapse>

      <Typography variant="body2" color="text.secondary" mb={1.5}>
        {loading ? 'Buscando...' : `${total} produto${total === 1 ? '' : 's'} encontrado${total === 1 ? '' : 's'}`}
      </Typography>

      {loading && items.length === 0 && sections.length === 0 && (
        <BrandLoader label="Carregando produtos..." />
      )}

      {/* Vitrine: sem filtro nenhum, o catálogo aparece separado por nicho.
          Assim que o usuário filtra ou ordena, vira grade única — misturar os
          dois modos confundiria o que está sendo comparado. */}
      {showSections ? (
        sections.map((section) => (
          <Box key={section.category} mb={4}>
            <Box
              display="flex"
              alignItems="baseline"
              justifyContent="space-between"
              mb={1.5}
            >
              <Typography variant="h6" fontWeight={800}>
                {section.category}
                <Typography
                  component="span"
                  color="text.secondary"
                  fontSize={13}
                  fontWeight={500}
                  ml={1}
                >
                  {section.total} produto{section.total === 1 ? '' : 's'}
                </Typography>
              </Typography>
              {section.total > section.items.length && (
                <Button
                  size="small"
                  onClick={() => (setCategory(section.category), setPage(1))}
                >
                  Ver todos
                </Button>
              )}
            </Box>
            <Grid container spacing={2.5}>
              {section.items.map((p, index) => (
                <Grid item xs={6} sm={4} md={3} lg={2} key={p.id}>
                  <ProductCard
                    product={p}
                    rank={index + 1}
                    onToggleFavorite={toggleFavorite}
                  />
                </Grid>
              ))}
            </Grid>
          </Box>
        ))
      ) : null}

      {/* O scroll infinito é controlado pelo hook, que observa a posição da
          página — não há sentinela no DOM. */}
      {showSections && loadingSections && sections.length > 0 && (
        <BrandLoader label="Carregando mais categorias..." minHeight={140} />
      )}

      {!showSections && (
        <>
          <Grid
            container
            spacing={2.5}
            sx={{ opacity: loading ? 0.5 : 1, transition: 'opacity .2s' }}
          >
            {items.map((p, index) => (
              <Grid item xs={6} sm={4} md={3} lg={2} key={p.id}>
                <ProductCard
                  product={p}
                  rank={(page - 1) * pageSize + index + 1}
                  onToggleFavorite={toggleFavorite}
                />
              </Grid>
            ))}
          </Grid>

          {/* Sem paginação por clique: o scroll traz a próxima página. */}
          {loading && items.length > 0 && (
            <BrandLoader label="Carregando mais produtos..." minHeight={120} />
          )}
          {!loading && items.length >= total && total > 0 && (
            <Typography
              color="text.secondary"
              textAlign="center"
              fontSize={13}
              mt={4}
            >
              Você viu todos os {total} produtos.
            </Typography>
          )}
        </>
      )}
    </>
  );
}
