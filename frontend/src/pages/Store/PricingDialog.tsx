import {
  Alert,
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  Grid,
  Typography,
} from '@mui/material';
import { useEffect, useState } from 'react';
import { FormField } from '@/components/ui/Filters';
import {
  PricingResult,
  Store,
  StoreProduct,
  storesService,
} from '@/services/stores.service';
import { formatMoney } from '@/utils/format';

interface PricingDialogProps {
  store: Store;
  product: StoreProduct | null;
  onClose: () => void;
  /** Chamado quando o usuário salva o custo informado aqui de volta no SKU. */
  onCostSaved: () => void;
}

const number = (value: string) => Number(value.replace(',', '.')) || 0;

export function PricingDialog({
  store,
  product,
  onClose,
  onCostSaved,
}: PricingDialogProps) {
  const [cost, setCost] = useState('');
  const [price, setPrice] = useState('');
  const [shippingCost, setShippingCost] = useState('');
  const [otherCost, setOtherCost] = useState('');
  const [commissionPct, setCommissionPct] = useState(store.commissionPct);
  const [taxPct, setTaxPct] = useState(store.taxPct);
  const [targetMarginPct, setTargetMarginPct] = useState('30');
  const [result, setResult] = useState<PricingResult | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!product) return;
    setCost(product.cost === null ? '' : String(product.cost));
    setPrice(product.price === null ? '' : String(product.price));
    setResult(null);
  }, [product]);

  useEffect(() => {
    if (!product) return;
    const timer = setTimeout(() => {
      storesService
        .simulatePricing(store.id, {
          cost: number(cost),
          price: price ? number(price) : undefined,
          shippingCost: shippingCost ? number(shippingCost) : undefined,
          otherCost: otherCost ? number(otherCost) : undefined,
          commissionPct: number(commissionPct),
          taxPct: number(taxPct),
          targetMarginPct: targetMarginPct
            ? number(targetMarginPct)
            : undefined,
        })
        .then(setResult)
        .catch(console.error);
    }, 350);
    return () => clearTimeout(timer);
  }, [
    product,
    store.id,
    cost,
    price,
    shippingCost,
    otherCost,
    commissionPct,
    taxPct,
    targetMarginPct,
  ]);

  async function saveCost() {
    if (!product) return;
    setSaving(true);
    try {
      await storesService.updateProduct(store.id, product.id, {
        cost: number(cost),
      });
      onCostSaved();
      onClose();
    } finally {
      setSaving(false);
    }
  }

  const money = (value: number) => formatMoney(value, store.currency);

  return (
    <Dialog open={product !== null} onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle>
        Calculadora de preço
        {product && (
          <Typography variant="body2" color="text.secondary">
            {product.sku} · {product.title}
          </Typography>
        )}
      </DialogTitle>
      <DialogContent dividers>
        <Grid container spacing={2}>
          <Grid item xs={6}>
            <FormField
              label="Custo do produto"
              value={cost}
              onChange={(event) => setCost(event.target.value)}
              inputProps={{ inputMode: 'decimal' }}
            />
          </Grid>
          <Grid item xs={6}>
            <FormField
              label="Preço de venda"
              value={price}
              onChange={(event) => setPrice(event.target.value)}
              inputProps={{ inputMode: 'decimal' }}
            />
          </Grid>
          <Grid item xs={6}>
            <FormField
              label="Frete por unidade"
              value={shippingCost}
              onChange={(event) => setShippingCost(event.target.value)}
              inputProps={{ inputMode: 'decimal' }}
            />
          </Grid>
          <Grid item xs={6}>
            <FormField
              label="Embalagem e outros"
              value={otherCost}
              onChange={(event) => setOtherCost(event.target.value)}
              inputProps={{ inputMode: 'decimal' }}
            />
          </Grid>
          <Grid item xs={4}>
            <FormField
              label="Comissão %"
              value={commissionPct}
              onChange={(event) => setCommissionPct(event.target.value)}
              inputProps={{ inputMode: 'decimal' }}
            />
          </Grid>
          <Grid item xs={4}>
            <FormField
              label="Imposto %"
              value={taxPct}
              onChange={(event) => setTaxPct(event.target.value)}
              inputProps={{ inputMode: 'decimal' }}
            />
          </Grid>
          <Grid item xs={4}>
            <FormField
              label="Margem alvo %"
              value={targetMarginPct}
              onChange={(event) => setTargetMarginPct(event.target.value)}
              inputProps={{ inputMode: 'decimal' }}
            />
          </Grid>
        </Grid>

        {result && (
          <Box mt={3}>
            <Divider sx={{ mb: 2 }} />
            {result.warning && (
              <Alert severity="warning" sx={{ mb: 2, borderRadius: 3 }}>
                {result.warning}
              </Alert>
            )}
            <Grid container spacing={2}>
              <Result label="Custo total por unidade" value={money(result.unitCost)} />
              {result.breakEvenPrice !== null && (
                <Result
                  label="Preço de equilíbrio"
                  value={money(result.breakEvenPrice)}
                  helper="abaixo disso você paga para vender"
                />
              )}
              {result.netProfit !== null && (
                <Result
                  label="Lucro por unidade"
                  value={money(result.netProfit)}
                  negative={result.netProfit < 0}
                />
              )}
              {result.marginPct !== null && (
                <Result
                  label="Margem atual"
                  value={`${result.marginPct}%`}
                  negative={result.marginPct < 0}
                />
              )}
              {result.suggestedPrice !== null && (
                <Result
                  label={`Preço para ${targetMarginPct}% de margem`}
                  value={money(result.suggestedPrice)}
                  accent
                />
              )}
            </Grid>
          </Box>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Fechar</Button>
        <Button variant="contained" onClick={saveCost} disabled={saving || !cost}>
          Salvar custo no SKU
        </Button>
      </DialogActions>
    </Dialog>
  );
}

function Result({
  label,
  value,
  helper,
  accent,
  negative,
}: {
  label: string;
  value: string;
  helper?: string;
  accent?: boolean;
  negative?: boolean;
}) {
  return (
    <Grid item xs={6}>
      <Typography variant="overline" color="text.secondary" display="block">
        {label}
      </Typography>
      <Typography
        variant="h6"
        color={
          negative ? 'error.main' : accent ? 'primary.main' : 'text.primary'
        }
      >
        {value}
      </Typography>
      {helper && (
        <Typography variant="caption" color="text.secondary">
          {helper}
        </Typography>
      )}
    </Grid>
  );
}
