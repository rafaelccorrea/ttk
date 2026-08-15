import CheckCircleRoundedIcon from '@mui/icons-material/CheckCircleRounded';
import UploadFileRoundedIcon from '@mui/icons-material/UploadFileRounded';
import WarningAmberRoundedIcon from '@mui/icons-material/WarningAmberRounded';
import {
  Alert,
  AlertTitle,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  Divider,
  Grid,
  Typography,
} from '@mui/material';
import { useEffect, useRef, useState } from 'react';
import {
  ImportReport,
  StoreDataset,
  storesService,
} from '@/services/stores.service';

interface DatasetCard {
  dataset: StoreDataset;
  title: string;
  where: string;
}

/** Onde o seller acha cada relatório no Seller Center. */
const DATASETS: DatasetCard[] = [
  {
    dataset: 'orders',
    title: 'Pedidos',
    where: 'Pedidos → Gerenciar pedidos → Exportar',
  },
  {
    dataset: 'products',
    title: 'Produtos',
    where: 'Produtos → Gerenciar produtos → Exportar',
  },
  {
    dataset: 'settlements',
    title: 'Repasses',
    where: 'Finanças → Extrato → Exportar',
  },
];

const DATASET_LABEL: Record<StoreDataset, string> = {
  orders: 'Pedidos',
  products: 'Produtos',
  settlements: 'Repasses',
};

interface ImportPanelProps {
  storeId: string;
  onImported: () => void;
}

export function ImportPanel({ storeId, onImported }: ImportPanelProps) {
  const [history, setHistory] = useState<ImportReport[]>([]);
  const [busy, setBusy] = useState<StoreDataset | null>(null);
  const [report, setReport] = useState<ImportReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const inputs = useRef<Record<string, HTMLInputElement | null>>({});

  useEffect(() => {
    storesService.imports(storeId).then(setHistory).catch(console.error);
  }, [storeId]);

  async function handleFile(dataset: StoreDataset, file: File) {
    setBusy(dataset);
    setError(null);
    setReport(null);
    try {
      const result = await storesService.import(storeId, dataset, file);
      setReport(result);
      setHistory(await storesService.imports(storeId));
      onImported();
    } catch (err: any) {
      setError(
        err?.response?.data?.message ??
          'Não foi possível importar o arquivo. Tente novamente.',
      );
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      <Alert severity="info" sx={{ mb: 3, borderRadius: 3 }}>
        <AlertTitle>Como trazer os dados da sua loja</AlertTitle>
        Exporte os relatórios no Seller Center do TikTok Shop e envie os
        arquivos aqui — aceitamos <strong>.xlsx</strong> e <strong>.csv</strong>,
        do jeito que vierem. Reimportar o mesmo período atualiza os registros —
        nada é duplicado, e o custo que você cadastrou é preservado.
      </Alert>

      <Grid container spacing={2.5} mb={3}>
        {DATASETS.map((item) => (
          <Grid item xs={12} md={4} key={item.dataset}>
            <Card sx={{ height: '100%' }}>
              <CardContent>
                <Typography variant="h6" gutterBottom>
                  {item.title}
                </Typography>
                <Typography variant="body2" color="text.secondary" mb={2}>
                  {item.where}
                </Typography>
                <input
                  hidden
                  type="file"
                  accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                  ref={(node) => {
                    inputs.current[item.dataset] = node;
                  }}
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    if (file) handleFile(item.dataset, file);
                    event.target.value = '';
                  }}
                />
                <Button
                  fullWidth
                  variant="outlined"
                  disabled={busy !== null}
                  startIcon={
                    busy === item.dataset ? (
                      <CircularProgress size={16} color="inherit" />
                    ) : (
                      <UploadFileRoundedIcon />
                    )
                  }
                  onClick={() => inputs.current[item.dataset]?.click()}
                >
                  {busy === item.dataset ? 'Importando...' : 'Enviar planilha'}
                </Button>
              </CardContent>
            </Card>
          </Grid>
        ))}
      </Grid>

      {error && (
        <Alert severity="error" sx={{ mb: 3, borderRadius: 3 }}>
          {error}
        </Alert>
      )}

      {report && (
        <Alert
          severity={report.skipped > 0 ? 'warning' : 'success'}
          icon={
            report.skipped > 0 ? (
              <WarningAmberRoundedIcon />
            ) : (
              <CheckCircleRoundedIcon />
            )
          }
          sx={{ mb: 3, borderRadius: 3 }}
        >
          <AlertTitle>
            {DATASET_LABEL[report.dataset]}: {report.created} novos,{' '}
            {report.updated} atualizados
          </AlertTitle>
          {report.skipped > 0 && (
            <>
              <Typography variant="body2" mb={1}>
                {report.skipped} linha(s) foram puladas:
              </Typography>
              <Box component="ul" sx={{ m: 0, pl: 2.5 }}>
                {report.issues.slice(0, 8).map((issue) => (
                  <li key={`${issue.line}-${issue.message}`}>
                    <Typography variant="body2">
                      Linha {issue.line}: {issue.message}
                    </Typography>
                  </li>
                ))}
              </Box>
            </>
          )}
        </Alert>
      )}

      <Typography variant="h6" mb={1.5}>
        Histórico
      </Typography>
      {history.length === 0 ? (
        <Typography color="text.secondary">
          Nenhuma importação ainda.
        </Typography>
      ) : (
        <Card>
          <CardContent sx={{ py: 1 }}>
            {history.map((item, index) => (
              <Box key={item.id}>
                {index > 0 && <Divider />}
                <Box
                  display="flex"
                  alignItems="center"
                  gap={1.5}
                  flexWrap="wrap"
                  py={1.5}
                >
                  <Chip
                    size="small"
                    label={DATASET_LABEL[item.dataset]}
                    sx={{ fontWeight: 700 }}
                  />
                  <Typography variant="body2" sx={{ flexGrow: 1 }}>
                    {item.fileName ?? 'arquivo.csv'}
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    {item.created} novos · {item.updated} atualizados
                    {item.skipped > 0 && ` · ${item.skipped} pulados`}
                  </Typography>
                  {item.createdAt && (
                    <Typography variant="caption" color="text.secondary">
                      {new Date(item.createdAt).toLocaleString('pt-BR')}
                    </Typography>
                  )}
                </Box>
              </Box>
            ))}
          </CardContent>
        </Card>
      )}
    </>
  );
}
