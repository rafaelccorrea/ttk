import CalculateRoundedIcon from '@mui/icons-material/CalculateRounded';
import {
  Box,
  Card,
  Chip,
  IconButton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TablePagination,
  TableRow,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import { useEffect, useState } from 'react';
import { BrandLoader } from '@/components/ui/BrandLoader';
import { FilterBar, SearchField, SelectField } from '@/components/ui/Filters';
import { StoreProduct, storesService } from '@/services/stores.service';
import { formatMoney } from '@/utils/format';
import { ExportButton } from './ExportButton';

const SORT_OPTIONS = [
  { value: 'title', label: 'Nome (A-Z)' },
  { value: 'margin', label: 'Maior margem' },
  { value: 'stock', label: 'Menor estoque' },
  { value: 'price', label: 'Maior preço' },
];

/**
 * Campo de custo editável direto na linha. É o dado que o TikTok nunca fornece
 * e sem o qual nenhuma margem existe — por isso fica no caminho mais curto.
 */
function CostCell({
  product,
  currency,
  onSave,
}: {
  product: StoreProduct;
  currency: string;
  onSave: (cost: number) => Promise<void>;
}) {
  const [value, setValue] = useState(
    product.cost === null ? '' : String(product.cost),
  );
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setValue(product.cost === null ? '' : String(product.cost));
  }, [product.cost]);

  async function commit() {
    const parsed = Number(value.replace(',', '.'));
    if (!Number.isFinite(parsed) || parsed < 0) return;
    if (parsed === product.cost) return;
    setSaving(true);
    try {
      await onSave(parsed);
    } finally {
      setSaving(false);
    }
  }

  return (
    <TextField
      size="small"
      value={value}
      disabled={saving}
      onChange={(event) => setValue(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === 'Enter') (event.target as HTMLInputElement).blur();
      }}
      placeholder={currency === 'BRL' ? 'R$ 0,00' : '0.00'}
      inputProps={{ inputMode: 'decimal', style: { textAlign: 'right' } }}
      sx={{ width: 110, '& .MuiOutlinedInput-root': { borderRadius: 2 } }}
    />
  );
}

interface ProductsTabProps {
  storeId: string;
  currency: string;
  refreshKey: number;
  onSimulate: (product: StoreProduct) => void;
}

export function ProductsTab({
  storeId,
  currency,
  refreshKey,
  onSimulate,
}: ProductsTabProps) {
  const [products, setProducts] = useState<StoreProduct[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [limit, setLimit] = useState(25);
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState('title');
  const [missingCost, setMissingCost] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    storesService
      .products(storeId, {
        page: page + 1,
        limit,
        search: search || undefined,
        sort: sort as 'title' | 'stock' | 'price' | 'margin',
        missingCost: missingCost ? 'true' : undefined,
      })
      .then((data) => {
        setProducts(data.items);
        setTotal(data.total);
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [storeId, page, limit, search, sort, missingCost, refreshKey]);

  async function saveCost(product: StoreProduct, cost: number) {
    const updated = await storesService.updateProduct(storeId, product.id, {
      cost,
    });
    setProducts((prev) =>
      prev.map((item) => (item.id === updated.id ? updated : item)),
    );
  }

  return (
    <>
      <FilterBar>
        <SearchField
          value={search}
          onChange={(value) => {
            setSearch(value);
            setPage(0);
          }}
          placeholder="Buscar por SKU, nome ou categoria…"
        />
        <SelectField value={sort} onChange={setSort} options={SORT_OPTIONS} />
        <Chip
          label="Sem custo cadastrado"
          clickable
          color={missingCost ? 'primary' : 'default'}
          variant={missingCost ? 'filled' : 'outlined'}
          onClick={() => {
            setMissingCost((prev) => !prev);
            setPage(0);
          }}
          sx={{ fontWeight: 700 }}
        />
        <Box ml="auto">
          <ExportButton
            label="Exportar catálogo"
            onExport={() => storesService.exportProducts(storeId)}
          />
        </Box>
      </FilterBar>

      {loading ? (
        <BrandLoader label="Carregando catálogo..." />
      ) : products.length === 0 ? (
        <Typography color="text.secondary">
          Nenhum produto encontrado. Importe o relatório de produtos para
          começar.
        </Typography>
      ) : (
        <Card>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>SKU</TableCell>
                <TableCell>Produto</TableCell>
                <TableCell align="right">Preço</TableCell>
                <TableCell align="right">Custo</TableCell>
                <TableCell align="right">Lucro/un.</TableCell>
                <TableCell align="right">Margem</TableCell>
                <TableCell align="right">Estoque</TableCell>
                <TableCell align="center" />
              </TableRow>
            </TableHead>
            <TableBody>
              {products.map((product) => (
                <TableRow key={product.id} hover>
                  <TableCell sx={{ fontFamily: 'monospace' }}>
                    {product.sku}
                  </TableCell>
                  <TableCell>
                    <Typography variant="body2">{product.title}</Typography>
                    {product.category && (
                      <Typography variant="caption" color="text.secondary">
                        {product.category}
                      </Typography>
                    )}
                  </TableCell>
                  <TableCell align="right">
                    {product.price === null
                      ? '—'
                      : formatMoney(product.price, currency)}
                  </TableCell>
                  <TableCell align="right">
                    <CostCell
                      product={product}
                      currency={currency}
                      onSave={(cost) => saveCost(product, cost)}
                    />
                  </TableCell>
                  <TableCell align="right">
                    {product.netProfit === null
                      ? '—'
                      : formatMoney(product.netProfit, currency)}
                  </TableCell>
                  <TableCell align="right">
                    {product.marginPct === null ? (
                      '—'
                    ) : (
                      <Typography
                        variant="body2"
                        fontWeight={700}
                        color={
                          product.marginPct >= 0 ? 'success.main' : 'error.main'
                        }
                      >
                        {product.marginPct}%
                      </Typography>
                    )}
                  </TableCell>
                  <TableCell align="right">
                    <Box display="flex" alignItems="center" justifyContent="flex-end" gap={0.75}>
                      {product.stock ?? '—'}
                      {product.lowStock && (
                        <Chip
                          size="small"
                          label="baixo"
                          sx={{
                            height: 20,
                            fontWeight: 700,
                            bgcolor: 'rgba(220,38,38,0.10)',
                            color: '#dc2626',
                          }}
                        />
                      )}
                    </Box>
                  </TableCell>
                  <TableCell align="center">
                    <Tooltip title="Simular preço e margem">
                      <IconButton
                        size="small"
                        onClick={() => onSimulate(product)}
                      >
                        <CalculateRoundedIcon fontSize="small" />
                      </IconButton>
                    </Tooltip>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <TablePagination
            component="div"
            count={total}
            page={page}
            onPageChange={(_, next) => setPage(next)}
            rowsPerPage={limit}
            onRowsPerPageChange={(event) => {
              setLimit(Number(event.target.value));
              setPage(0);
            }}
            rowsPerPageOptions={[25, 50, 100]}
            labelRowsPerPage="Por página"
          />
        </Card>
      )}
    </>
  );
}
