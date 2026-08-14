import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Grid,
  IconButton,
  MenuItem,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from '@mui/material';
import DeleteIcon from '@mui/icons-material/Delete';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import { FormEvent, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { productsService, RankedProduct } from '@/services/products.service';
import { Script, studioService } from '@/services/studio.service';

export function StudioPage() {
  const [searchParams] = useSearchParams();
  const [type, setType] = useState<'live' | 'video'>(
    searchParams.get('type') === 'video' ? 'video' : 'live',
  );
  const [productId, setProductId] = useState(
    searchParams.get('productId') ?? '',
  );
  const [productName, setProductName] = useState('');
  const [productDescription, setProductDescription] = useState('');
  const [tone, setTone] = useState('');
  const [topProducts, setTopProducts] = useState<RankedProduct[]>([]);
  const [scripts, setScripts] = useState<Script[]>([]);
  const [result, setResult] = useState<Script | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    productsService
      .rank({ period: 30, limit: 50 })
      .then((data) => setTopProducts(data.items))
      .catch(console.error);
    studioService.listScripts().then(setScripts).catch(console.error);
  }, []);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const script = await studioService.generate({
        type,
        productId: productId || undefined,
        productName: productId ? undefined : productName,
        productDescription: productDescription || undefined,
        tone: tone || undefined,
      });
      setResult(script);
      setScripts((prev) => [script, ...prev]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao gerar roteiro');
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete(id: string) {
    await studioService.deleteScript(id);
    setScripts((prev) => prev.filter((s) => s.id !== id));
    if (result?.id === id) setResult(null);
  }

  return (
    <>
      <Typography variant="h5" gutterBottom>
        Estúdio — Roteirizar com IA
      </Typography>

      <Grid container spacing={3}>
        <Grid item xs={12} md={5}>
          <Card>
            <CardContent>
              <form onSubmit={handleSubmit}>
                <ToggleButtonGroup
                  exclusive
                  fullWidth
                  size="small"
                  value={type}
                  onChange={(_e, value) => value && setType(value)}
                  sx={{ mb: 2 }}
                >
                  <ToggleButton value="live">Roteiro de Live</ToggleButton>
                  <ToggleButton value="video">Roteiro de Vídeo</ToggleButton>
                </ToggleButtonGroup>

                <TextField
                  select
                  fullWidth
                  size="small"
                  label="Produto do catálogo (opcional)"
                  value={productId}
                  onChange={(e) => setProductId(e.target.value)}
                  margin="normal"
                >
                  <MenuItem value="">Descrever meu próprio produto</MenuItem>
                  {topProducts.map((p) => (
                    <MenuItem key={p.id} value={p.id}>
                      {p.title}
                    </MenuItem>
                  ))}
                </TextField>

                {!productId && (
                  <TextField
                    fullWidth
                    size="small"
                    required
                    label="Nome do produto"
                    value={productName}
                    onChange={(e) => setProductName(e.target.value)}
                    margin="normal"
                  />
                )}
                <TextField
                  fullWidth
                  size="small"
                  multiline
                  minRows={3}
                  label="Detalhes (preço, diferenciais, garantia...)"
                  value={productDescription}
                  onChange={(e) => setProductDescription(e.target.value)}
                  margin="normal"
                />
                <TextField
                  fullWidth
                  size="small"
                  label="Tom (opcional)"
                  placeholder="ex.: divertido e urgente"
                  value={tone}
                  onChange={(e) => setTone(e.target.value)}
                  margin="normal"
                />
                {error && <Alert severity="error">{error}</Alert>}
                <Button
                  type="submit"
                  variant="contained"
                  fullWidth
                  disabled={busy}
                  sx={{ mt: 2 }}
                >
                  {busy ? 'Gerando...' : 'Gerar roteiro'}
                </Button>
              </form>
            </CardContent>
          </Card>
        </Grid>

        <Grid item xs={12} md={7}>
          {result && (
            <Card sx={{ mb: 2 }}>
              <CardContent>
                <Box display="flex" justifyContent="space-between">
                  <Typography variant="h6">{result.productName}</Typography>
                  <IconButton
                    size="small"
                    onClick={() =>
                      navigator.clipboard.writeText(result.content)
                    }
                    aria-label="copiar"
                  >
                    <ContentCopyIcon fontSize="small" />
                  </IconButton>
                </Box>
                <Typography
                  component="pre"
                  variant="body2"
                  sx={{ whiteSpace: 'pre-wrap', fontFamily: 'inherit' }}
                >
                  {result.content}
                </Typography>
              </CardContent>
            </Card>
          )}

          <Typography variant="h6" gutterBottom>
            Roteiros salvos
          </Typography>
          {scripts.length === 0 && (
            <Typography color="text.secondary">
              Nenhum roteiro ainda — gere o primeiro ao lado.
            </Typography>
          )}
          {scripts.map((s) => (
            <Card key={s.id} sx={{ mb: 1 }}>
              <CardContent
                sx={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  py: 1.5,
                }}
              >
                <Box
                  sx={{ cursor: 'pointer', flexGrow: 1 }}
                  onClick={() => setResult(s)}
                >
                  <Typography>{s.productName}</Typography>
                  <Typography variant="body2" color="text.secondary">
                    {s.type === 'live' ? 'Live' : 'Vídeo'} ·{' '}
                    {new Date(s.createdAt).toLocaleString('pt-BR')}
                  </Typography>
                </Box>
                <IconButton
                  size="small"
                  onClick={() => handleDelete(s.id)}
                  aria-label="excluir"
                >
                  <DeleteIcon fontSize="small" />
                </IconButton>
              </CardContent>
            </Card>
          ))}
        </Grid>
      </Grid>
    </>
  );
}
