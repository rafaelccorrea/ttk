import StorefrontRoundedIcon from '@mui/icons-material/StorefrontRounded';
import {
  Box,
  Button,
  Card,
  CardContent,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Grid,
  Tab,
  Tabs,
  Typography,
} from '@mui/material';
import { useCallback, useEffect, useState } from 'react';
import { BrandLoader } from '@/components/ui/BrandLoader';
import { FormField, SelectField } from '@/components/ui/Filters';
import { Store, StoreProduct, storesService } from '@/services/stores.service';
import { ImportPanel } from './ImportPanel';
import { OpportunitiesTab } from './OpportunitiesTab';
import { OrdersTab } from './OrdersTab';
import { OverviewTab } from './OverviewTab';
import { PricingDialog } from './PricingDialog';
import { ProductsTab } from './ProductsTab';

const PERIOD_OPTIONS = [
  { value: '7', label: 'Últimos 7 dias' },
  { value: '30', label: 'Últimos 30 dias' },
  { value: '90', label: 'Últimos 90 dias' },
];

const TABS = [
  'Visão geral',
  'Pedidos',
  'Produtos',
  'Oportunidades',
  'Importar',
] as const;

export function StorePage() {
  const [stores, setStores] = useState<Store[]>([]);
  const [storeId, setStoreId] = useState('');
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState(0);
  const [period, setPeriod] = useState('30');
  const [refreshKey, setRefreshKey] = useState(0);
  const [creating, setCreating] = useState(false);
  const [simulating, setSimulating] = useState<StoreProduct | null>(null);

  const loadStores = useCallback(async () => {
    const data = await storesService.list();
    setStores(data);
    setStoreId((current) => current || data[0]?.id || '');
    return data;
  }, []);

  useEffect(() => {
    loadStores()
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [loadStores]);

  const store = stores.find((item) => item.id === storeId) ?? null;
  const refresh = () => setRefreshKey((key) => key + 1);

  if (loading) return <BrandLoader label="Carregando suas lojas..." />;

  if (!store) {
    return (
      <>
        <EmptyState onCreate={() => setCreating(true)} />
        <CreateStoreDialog
          open={creating}
          onClose={() => setCreating(false)}
          onCreated={async (created) => {
            await loadStores();
            setStoreId(created.id);
            setCreating(false);
            setTab(TABS.indexOf('Importar'));
          }}
        />
      </>
    );
  }

  return (
    <>
      <Box
        display="flex"
        alignItems="flex-start"
        justifyContent="space-between"
        gap={2}
        flexWrap="wrap"
        mb={2}
      >
        <Box>
          <Typography variant="h5">Minha Loja</Typography>
          <Typography color="text.secondary">
            Pedidos, catálogo, margem real e oportunidades da sua loja no TikTok
            Shop.
          </Typography>
        </Box>
        <Box display="flex" gap={1.25} alignItems="center" flexWrap="wrap">
          {stores.length > 1 && (
            <SelectField
              value={storeId}
              onChange={setStoreId}
              options={stores.map((item) => ({
                value: item.id,
                label: item.name,
              }))}
            />
          )}
          <SelectField
            value={period}
            onChange={setPeriod}
            options={PERIOD_OPTIONS}
          />
          <Button variant="outlined" onClick={() => setCreating(true)}>
            Nova loja
          </Button>
        </Box>
      </Box>

      <Tabs
        value={tab}
        onChange={(_, next) => setTab(next)}
        sx={{ mb: 3, borderBottom: '1px solid rgba(22,24,35,0.08)' }}
        variant="scrollable"
        allowScrollButtonsMobile
      >
        {TABS.map((label) => (
          <Tab key={label} label={label} sx={{ fontWeight: 700 }} />
        ))}
      </Tabs>

      {tab === 0 && (
        <OverviewTab
          storeId={store.id}
          period={Number(period)}
          refreshKey={refreshKey}
          onGoToImports={() => setTab(TABS.indexOf('Importar'))}
          onGoToProducts={() => setTab(TABS.indexOf('Produtos'))}
        />
      )}
      {tab === 1 && (
        <OrdersTab
          storeId={store.id}
          period={Number(period)}
          currency={store.currency}
          refreshKey={refreshKey}
        />
      )}
      {tab === 2 && (
        <ProductsTab
          storeId={store.id}
          currency={store.currency}
          refreshKey={refreshKey}
          onSimulate={setSimulating}
        />
      )}
      {tab === 3 && (
        <OpportunitiesTab
          storeId={store.id}
          period={Number(period)}
          refreshKey={refreshKey}
        />
      )}
      {tab === 4 && <ImportPanel storeId={store.id} onImported={refresh} />}

      <PricingDialog
        store={store}
        product={simulating}
        onClose={() => setSimulating(null)}
        onCostSaved={refresh}
      />

      <CreateStoreDialog
        open={creating}
        onClose={() => setCreating(false)}
        onCreated={async (created) => {
          await loadStores();
          setStoreId(created.id);
          setCreating(false);
          setTab(TABS.indexOf('Importar'));
        }}
      />
    </>
  );
}

function EmptyState({ onCreate }: { onCreate: () => void }) {
  return (
    <Box maxWidth={720} mx="auto" textAlign="center" py={6}>
      <StorefrontRoundedIcon sx={{ fontSize: 56, color: 'primary.main' }} />
      <Typography variant="h5" mt={1.5} mb={1}>
        Conecte sua loja
      </Typography>
      <Typography color="text.secondary" mb={4}>
        Cadastre sua loja e traga os relatórios do Seller Center para ver
        faturamento, margem real por SKU, pedidos atrasados e o que está em alta
        que você ainda não vende.
      </Typography>

      <Grid container spacing={2.5} mb={4} textAlign="left">
        {[
          {
            title: '1. Cadastre a loja',
            body: 'Informe o nome e a comissão que o TikTok cobra de você.',
          },
          {
            title: '2. Exporte os relatórios',
            body: 'No Seller Center: Pedidos, Produtos e Extrato financeiro (XLSX ou CSV).',
          },
          {
            title: '3. Envie os arquivos',
            body: 'A plataforma consolida tudo e calcula sua margem real.',
          },
        ].map((step) => (
          <Grid item xs={12} md={4} key={step.title}>
            <Card sx={{ height: '100%' }}>
              <CardContent>
                <Typography variant="subtitle2" fontWeight={800} gutterBottom>
                  {step.title}
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  {step.body}
                </Typography>
              </CardContent>
            </Card>
          </Grid>
        ))}
      </Grid>

      <Button variant="contained" size="large" onClick={onCreate}>
        Cadastrar minha loja
      </Button>
    </Box>
  );
}

function CreateStoreDialog({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (store: Store) => void;
}) {
  const [name, setName] = useState('');
  const [commissionPct, setCommissionPct] = useState('5');
  const [taxPct, setTaxPct] = useState('0');
  const [dateOrder, setDateOrder] = useState<'dmy' | 'mdy'>('dmy');
  const [saving, setSaving] = useState(false);

  async function submit() {
    if (!name.trim()) return;
    setSaving(true);
    try {
      const created = await storesService.create({
        name: name.trim(),
        commissionPct: Number(commissionPct.replace(',', '.')) || 0,
        taxPct: Number(taxPct.replace(',', '.')) || 0,
        dateOrder,
      });
      setName('');
      onCreated(created);
    } catch (error) {
      console.error(error);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="xs">
      <DialogTitle>Cadastrar loja</DialogTitle>
      <DialogContent dividers>
        <Box display="flex" flexDirection="column" gap={2} pt={0.5}>
          <FormField
            label="Nome da loja"
            value={name}
            onChange={(event) => setName(event.target.value)}
            autoFocus
          />
          <Box display="flex" gap={2}>
            <FormField
              label="Comissão do TikTok %"
              value={commissionPct}
              onChange={(event) => setCommissionPct(event.target.value)}
              inputProps={{ inputMode: 'decimal' }}
            />
            <FormField
              label="Imposto %"
              value={taxPct}
              onChange={(event) => setTaxPct(event.target.value)}
              inputProps={{ inputMode: 'decimal' }}
            />
          </Box>
          <SelectField
            value={dateOrder}
            onChange={(value) => setDateOrder(value as 'dmy' | 'mdy')}
            options={[
              { value: 'dmy', label: 'Datas em dia/mês/ano (Brasil)' },
              { value: 'mdy', label: 'Datas em mês/dia/ano (EUA)' },
            ]}
            sx={{ minWidth: '100%' }}
          />
          <Typography variant="caption" color="text.secondary">
            Esses percentuais são usados no cálculo de margem e na calculadora
            de preço. Dá para ajustar depois.
          </Typography>
        </Box>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancelar</Button>
        <Button variant="contained" onClick={submit} disabled={saving || !name.trim()}>
          Cadastrar
        </Button>
      </DialogActions>
    </Dialog>
  );
}
