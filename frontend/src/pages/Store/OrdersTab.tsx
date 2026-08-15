import {
  Box,
  Card,
  Chip,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TablePagination,
  TableRow,
  Typography,
} from '@mui/material';
import { useEffect, useState } from 'react';
import { BrandLoader } from '@/components/ui/BrandLoader';
import { FilterBar, SearchField, SelectField } from '@/components/ui/Filters';
import { StoreOrder, storesService } from '@/services/stores.service';
import { formatMoney } from '@/utils/format';

const STAGE_STYLE: Record<
  StoreOrder['stage'],
  { label: string; bg: string; color: string }
> = {
  pendente: { label: 'A enviar', bg: 'rgba(245,158,11,0.14)', color: '#b45309' },
  enviado: { label: 'Enviado', bg: 'rgba(0,194,187,0.14)', color: '#0e7490' },
  concluido: { label: 'Concluído', bg: 'rgba(22,163,74,0.12)', color: '#16a34a' },
  cancelado: { label: 'Cancelado', bg: 'rgba(220,38,38,0.10)', color: '#dc2626' },
};

const STAGE_OPTIONS = [
  { value: '', label: 'Todos os status' },
  { value: 'pendente', label: 'A enviar' },
  { value: 'enviado', label: 'Enviado' },
  { value: 'concluido', label: 'Concluído' },
  { value: 'cancelado', label: 'Cancelado' },
];

interface OrdersTabProps {
  storeId: string;
  period: number;
  currency: string;
  refreshKey: number;
}

export function OrdersTab({
  storeId,
  period,
  currency,
  refreshKey,
}: OrdersTabProps) {
  const [orders, setOrders] = useState<StoreOrder[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [limit, setLimit] = useState(25);
  const [stage, setStage] = useState('');
  const [search, setSearch] = useState('');
  const [lateOnly, setLateOnly] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    storesService
      .orders(storeId, {
        period,
        page: page + 1,
        limit,
        stage: stage || undefined,
        search: search || undefined,
        lateOnly: lateOnly ? 'true' : undefined,
      })
      .then((data) => {
        setOrders(data.items);
        setTotal(data.total);
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [storeId, period, page, limit, stage, search, lateOnly, refreshKey]);

  return (
    <>
      <FilterBar>
        <SearchField
          value={search}
          onChange={(value) => {
            setSearch(value);
            setPage(0);
          }}
          placeholder="Buscar por pedido ou SKU…"
        />
        <SelectField
          value={stage}
          onChange={(value) => {
            setStage(value);
            setPage(0);
          }}
          options={STAGE_OPTIONS}
        />
        <Chip
          label="Só atrasados"
          clickable
          color={lateOnly ? 'primary' : 'default'}
          variant={lateOnly ? 'filled' : 'outlined'}
          onClick={() => {
            setLateOnly((prev) => !prev);
            setPage(0);
          }}
          sx={{ fontWeight: 700 }}
        />
      </FilterBar>

      {loading ? (
        <BrandLoader label="Carregando pedidos..." />
      ) : orders.length === 0 ? (
        <Typography color="text.secondary">
          Nenhum pedido encontrado com esses filtros.
        </Typography>
      ) : (
        <Card>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Pedido</TableCell>
                <TableCell>Data</TableCell>
                <TableCell>Itens</TableCell>
                <TableCell align="right">Valor</TableCell>
                <TableCell>Envio</TableCell>
                <TableCell align="center">Status</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {orders.map((order) => (
                <TableRow key={order.id} hover>
                  <TableCell sx={{ fontFamily: 'monospace' }}>
                    {order.externalId}
                  </TableCell>
                  <TableCell>
                    {new Date(order.placedAt).toLocaleDateString('pt-BR')}
                  </TableCell>
                  <TableCell>
                    {order.items.length === 0 ? (
                      '—'
                    ) : (
                      <Box>
                        {order.items.map((item) => (
                          <Typography variant="body2" key={item.sku}>
                            {item.quantity}× {item.title ?? item.sku}
                          </Typography>
                        ))}
                      </Box>
                    )}
                  </TableCell>
                  <TableCell align="right">
                    {formatMoney(order.grossAmount, currency)}
                  </TableCell>
                  <TableCell>
                    {order.trackingCode ? (
                      <Typography variant="body2">
                        {order.shippingProvider ?? 'Transportadora'} ·{' '}
                        {order.trackingCode}
                      </Typography>
                    ) : order.shipBy ? (
                      <Typography
                        variant="body2"
                        color={order.late ? 'error.main' : 'text.secondary'}
                        fontWeight={order.late ? 700 : 400}
                      >
                        {order.late ? 'Atrasado desde ' : 'Enviar até '}
                        {new Date(order.shipBy).toLocaleDateString('pt-BR')}
                      </Typography>
                    ) : (
                      '—'
                    )}
                  </TableCell>
                  <TableCell align="center">
                    <Chip
                      size="small"
                      label={STAGE_STYLE[order.stage].label}
                      sx={{
                        fontWeight: 700,
                        bgcolor: STAGE_STYLE[order.stage].bg,
                        color: STAGE_STYLE[order.stage].color,
                      }}
                    />
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
