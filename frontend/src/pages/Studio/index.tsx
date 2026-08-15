import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Grid,
  IconButton,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from '@mui/material';
import DeleteIcon from '@mui/icons-material/Delete';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import { FormEvent, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { SearchableSelect } from '@/components/ui/SearchableSelect';
import { formatCurrency, formatNumber } from '@/utils/format';
import { proxyImage } from '@/utils/tiktok';
import { productsService, RankedProduct } from '@/services/products.service';
import { Script, studioService } from '@/services/studio.service';

/**
 * Tons sugeridos para o roteiro.
 *
 * O campo continua aceitando texto livre (`allowCustom`): a lista é atalho
 * para os tons que mais funcionam no TikTok Shop, não uma restrição.
 */
const TONES = [
  'Divertido e urgente',
  'Direto ao ponto',
  'Empolgado e enérgico',
  'Amigável e próximo',
  'Autoridade e especialista',
  'Emocional e pessoal',
  'Bem-humorado',
  'Educativo e didático',
  'Depoimento honesto',
  'Urgência e escassez',
  'Sofisticado e premium',
];

/**
 * Ficha do produto montada com o que já temos em mãos.
 *
 * São os mesmos dados que alimentam o catálogo — nada de chamada extra nem
 * de token gasto. Serve de ponto de partida para o usuário editar antes de
 * gerar o roteiro, em vez de começar de um campo vazio.
 */
function detalhesDoProduto(p: RankedProduct): string {
  const linhas = [
    `Produto: ${p.title}`,
    `Preço: ${formatCurrency(p.price)}`,
    p.storeName ? `Loja: ${p.storeName}` : null,
    `Categoria: ${p.category}`,
    p.rating ? `Avaliação: ${p.rating} de 5` : null,
    `Vendas nos últimos 30 dias: ${formatNumber(p.salesPeriod)}`,
    p.growthPct !== null
      ? `Crescimento no período: ${p.growthPct >= 0 ? '+' : ''}${p.growthPct}%`
      : null,
  ];
  return linhas.filter(Boolean).join('\n');
}

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

  // Último texto que este efeito escreveu. Só sobrescrevemos o que foi
  // preenchido automaticamente — o que o usuário digitou fica intocado.
  const autoDescricaoRef = useRef('');

  useEffect(() => {
    const produto = topProducts.find((p) => p.id === productId);
    const texto = produto ? detalhesDoProduto(produto) : '';
    setProductDescription((atual) => {
      const foiAutomatico = atual === autoDescricaoRef.current;
      if (!foiAutomatico && atual.trim() !== '') return atual;
      autoDescricaoRef.current = texto;
      return texto;
    });
  }, [productId, topProducts]);

  // Trava síncrona: `busy` só desabilita o botão no próximo render. Num
  // formulário isso é ainda mais fácil de disparar duas vezes (clique + Enter),
  // e cada envio extra é um roteiro cobrado de novo do usuário.
  const busyRef = useRef(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (busyRef.current) return;
    busyRef.current = true;
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
      busyRef.current = false;
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

                <SearchableSelect
                  fullWidth
                  label="Produto do catálogo (opcional)"
                  placeholder="Buscar produto…"
                  value={productId}
                  onChange={setProductId}
                  emptyLabel="Descrever meu próprio produto"
                  sx={{ mt: 2, mb: 1 }}
                  options={topProducts.map((p) => ({
                    value: p.id,
                    label: p.title,
                    imageUrl: p.imageUrl ? proxyImage(p.imageUrl) : null,
                    caption: [p.storeName, p.category].filter(Boolean).join(' · '),
                  }))}
                />

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
                  helperText={
                    productId
                      ? 'Preenchido com os dados do catálogo — edite à vontade.'
                      : undefined
                  }
                />
                <SearchableSelect
                  fullWidth
                  allowCustom
                  label="Tom (opcional)"
                  placeholder="Escolha ou escreva o seu"
                  value={tone}
                  onChange={setTone}
                  sx={{ mt: 2, mb: 1 }}
                  options={TONES.map((t) => ({ value: t, label: t }))}
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
