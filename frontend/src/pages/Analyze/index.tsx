import AutoAwesomeRoundedIcon from '@mui/icons-material/AutoAwesomeRounded';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import UploadFileRoundedIcon from '@mui/icons-material/UploadFileRounded';
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
  Typography,
} from '@mui/material';
import { ChangeEvent, useEffect, useRef, useState } from 'react';
import { BrandLoader } from '@/components/ui/BrandLoader';
import { apiErrorMessage } from '@/contexts/AuthContext';
import { api } from '@/services/api';
import { productsService, RankedProduct } from '@/services/products.service';
import { Script } from '@/services/studio.service';

export function AnalyzePage() {
  const [fileName, setFileName] = useState<string | null>(null);
  const [transcript, setTranscript] = useState('');
  const [products, setProducts] = useState<RankedProduct[]>([]);
  const [productId, setProductId] = useState('');
  const [result, setResult] = useState<Script | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [transcribing, setTranscribing] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);

  useEffect(() => {
    productsService
      .rank({ period: 30, limit: 50 })
      .then((data) => setProducts(data.items))
      .catch(console.error);
  }, []);

  // Travas síncronas. `transcribing`/`analyzing` só desabilitam o controle no
  // próximo render — um duplo-clique cabe nessa janela, e cada disparo extra
  // é uma chamada paga (Whisper/Claude) cobrada de novo do usuário.
  const transcribingRef = useRef(false);
  const analyzingRef = useRef(false);

  async function handleFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    if (transcribingRef.current) return;
    transcribingRef.current = true;
    setError(null);
    setFileName(file.name);
    setTranscribing(true);
    try {
      const form = new FormData();
      form.append('file', file);
      const { data } = await api.post<{ transcript: string }>(
        '/studio/transcribe',
        form,
        { headers: { 'Content-Type': 'multipart/form-data' } },
      );
      setTranscript(data.transcript);
    } catch (err) {
      setError(apiErrorMessage(err));
    } finally {
      transcribingRef.current = false;
      setTranscribing(false);
      event.target.value = '';
    }
  }

  async function handleAnalyze() {
    if (analyzingRef.current) return;
    analyzingRef.current = true;
    setError(null);
    setAnalyzing(true);
    setResult(null);
    try {
      const { data } = await api.post<Script>('/studio/analyze', {
        transcript,
        productId: productId || undefined,
      });
      setResult(data);
    } catch (err) {
      setError(apiErrorMessage(err));
    } finally {
      analyzingRef.current = false;
      setAnalyzing(false);
    }
  }

  return (
    <>
      <Typography variant="h5">Analisar Vídeo Viral</Typography>
      <Typography color="text.secondary" mb={3}>
        Suba um vídeo (ou cole a transcrição), descubra por que ele funciona e
        gere a versão adaptada para o seu produto.
      </Typography>

      <Grid container spacing={3}>
        <Grid item xs={12} md={5}>
          <Card>
            <CardContent>
              <Typography variant="overline" color="text.secondary">
                1 · Transcrição
              </Typography>
              <Button
                component="label"
                fullWidth
                variant="outlined"
                startIcon={<UploadFileRoundedIcon />}
                disabled={transcribing}
                sx={{ my: 1.5, py: 1.5 }}
              >
                {transcribing
                  ? 'Transcrevendo com Whisper...'
                  : (fileName ?? 'Enviar vídeo ou áudio (máx. 25MB)')}
                <input
                  hidden
                  type="file"
                  accept="video/*,audio/*"
                  onChange={handleFile}
                />
              </Button>
              <TextField
                fullWidth
                multiline
                minRows={6}
                label="Transcrição (ou cole aqui manualmente)"
                value={transcript}
                onChange={(e) => setTranscript(e.target.value)}
              />

              <Typography
                variant="overline"
                color="text.secondary"
                display="block"
                mt={2}
              >
                2 · Seu produto (opcional)
              </Typography>
              <TextField
                select
                fullWidth
                size="small"
                label="Adaptar para o produto"
                value={productId}
                onChange={(e) => setProductId(e.target.value)}
                margin="dense"
              >
                <MenuItem value="">Nenhum — só analisar a estrutura</MenuItem>
                {products.map((p) => (
                  <MenuItem key={p.id} value={p.id}>
                    {p.title}
                  </MenuItem>
                ))}
              </TextField>

              {error && (
                <Alert severity="error" sx={{ mt: 1 }}>
                  {error}
                </Alert>
              )}
              <Button
                fullWidth
                variant="contained"
                startIcon={<AutoAwesomeRoundedIcon />}
                disabled={analyzing || !transcript.trim()}
                onClick={handleAnalyze}
                sx={{ mt: 2 }}
              >
                {analyzing ? 'Analisando...' : 'Analisar e gerar roteiro'}
              </Button>
            </CardContent>
          </Card>
        </Grid>

        <Grid item xs={12} md={7}>
          {analyzing && <BrandLoader label="Decompondo o vídeo..." />}
          {result && !analyzing && (
            <Card>
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
                <Typography variant="caption" color="text.secondary">
                  Salvo nos seus roteiros do Estúdio.
                </Typography>
              </CardContent>
            </Card>
          )}
          {!result && !analyzing && (
            <Box
              sx={{
                border: '1px dashed rgba(22,24,35,0.12)',
                borderRadius: 3,
                p: 6,
                textAlign: 'center',
                color: 'text.secondary',
              }}
            >
              <Typography>
                A análise aparecerá aqui: por que o vídeo funciona, a estrutura
                Gancho → Corpo → CTA e o roteiro adaptado.
              </Typography>
            </Box>
          )}
        </Grid>
      </Grid>
    </>
  );
}
