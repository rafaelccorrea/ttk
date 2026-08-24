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
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import { ChangeEvent, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { BrandLoader } from '@/components/ui/BrandLoader';
import { useSaldo } from '@/hooks/useSaldo';
import { useConfirmarGasto } from '@/hooks/useConfirmarGasto';
import { apiErrorMessage } from '@/contexts/AuthContext';
import { api } from '@/services/api';
import { SearchableSelect } from '@/components/ui/SearchableSelect';
import { proxyImage } from '@/utils/tiktok';
import { productsService, RankedProduct } from '@/services/products.service';
import { campaignsService, UserProduct } from '@/services/campaigns.service';
import { Script } from '@/services/studio.service';

export function AnalyzePage() {
  // A análise é cobrada como `analyze` (12 créditos); a transcrição, como
  // `transcribe`. Cada botão trava pelo próprio preço.
  const saldoAnalise = useSaldo('analyze');
  const saldoTranscricao = useSaldo('transcribe');
  const { confirmar, dialogo } = useConfirmarGasto();
  const [fileName, setFileName] = useState<string | null>(null);
  const [transcript, setTranscript] = useState('');
  const [products, setProducts] = useState<RankedProduct[]>([]);
  const [busca, setBusca] = useState('');
  const [buscando, setBuscando] = useState(false);
  // Produtos que o próprio vendedor cadastrou em Campanhas. Vêm inteiros do
  // servidor (lista curta), por isso não entram na busca com debounce.
  const [meusProdutos, setMeusProdutos] = useState<UserProduct[]>([]);
  // Valor do campo com prefixo de origem: `cat:` catálogo, `meu:` cadastro
  // próprio. Sem o prefixo os dois ids se confundiriam num único uuid.
  const [selecao, setSelecao] = useState('');
  // O escolhido pode não estar na lista atual (a busca seguinte troca as 50
  // opções). Guardá-lo à parte mantém título e foto no campo.
  const [escolhido, setEscolhido] = useState<RankedProduct | null>(null);
  const [result, setResult] = useState<Script | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [transcribing, setTranscribing] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);

  useEffect(() => {
    campaignsService.listProducts().then(setMeusProdutos).catch(console.error);
  }, []);

  // A lista é só o topo do catálogo: um produto fora dos 50 mais vendidos
  // existe mas nunca aparecia, porque o filtro do select era local. Agora a
  // busca vai ao servidor a cada digitação (com debounce).
  useEffect(() => {
    let cancelado = false;
    setBuscando(true);
    const timer = setTimeout(() => {
      productsService
        .rank({ period: 30, limit: 50, search: busca.trim() || undefined })
        .then((data) => {
          if (!cancelado) setProducts(data.items);
        })
        .catch(console.error)
        .finally(() => {
          if (!cancelado) setBuscando(false);
        });
    }, 350);
    return () => {
      cancelado = true;
      clearTimeout(timer);
    };
  }, [busca]);

  // Travas síncronas. `transcribing`/`analyzing` só desabilitam o controle no
  // próximo render — um duplo-clique cabe nessa janela, e cada disparo extra
  // é uma chamada paga (Whisper/Claude) cobrada de novo do usuário.
  const transcribingRef = useRef(false);
  const analyzingRef = useRef(false);

  async function handleFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    if (transcribingRef.current) return;
    /*
     * O custo depende da DURAÇÃO, que só o servidor conhece depois do upload:
     * cobra-se por bloco de 10 minutos começado. Prometer um total aqui seria
     * inventar — o diálogo mostra o preço do bloco e diz de que ele depende.
     */
    const autorizado = await confirmar({
      acao: 'transcribe',
      titulo: 'Transcrever vídeo',
      detalhe:
        'Cobrado por bloco de 10 minutos começado — o total depende da duração do arquivo.',
    });
    if (!autorizado) {
      event.target.value = '';
      return;
    }
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
      saldoTranscricao.recarregar();
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
    const autorizado = await confirmar({
      acao: 'analyze',
      titulo: 'Analisar vídeo viral',
    });
    if (!autorizado) return;
    analyzingRef.current = true;
    setError(null);
    setAnalyzing(true);
    setResult(null);
    try {
      const { data } = await api.post<Script>('/studio/analyze', {
        transcript,
        productId: selecao.startsWith('cat:') ? selecao.slice(4) : undefined,
        userProductId: selecao.startsWith('meu:')
          ? selecao.slice(4)
          : undefined,
      });
      setResult(data);
      // Gastou: o botão precisa saber, senão só um F5 revelaria o novo saldo.
      saldoAnalise.recarregar();
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
              {/* Sem saldo, o arquivo nem deve ser escolhido: o upload sobe
                  antes da cobrança, e deixar a pessoa esperar o envio de um
                  vídeo para ouvir "créditos insuficientes" é o pior desperdício
                  de tempo que esta tela pode causar. */}
              <Tooltip title={saldoTranscricao.motivo}>
                <span>
                  <Button
                    component="label"
                    fullWidth
                    variant="outlined"
                    startIcon={<UploadFileRoundedIcon />}
                    disabled={transcribing || saldoTranscricao.insuficiente}
                    sx={{ my: 1.5, py: 1.5, wordBreak: 'break-word', overflowWrap: 'anywhere', textAlign: 'center' }}
                  >
                    {transcribing
                      ? 'Transcrevendo com IA...'
                      : (fileName ?? 'Enviar vídeo ou áudio (máx. 25MB)')}
                    <input
                      hidden
                      type="file"
                      accept="video/*,audio/*"
                      onChange={handleFile}
                    />
                  </Button>
                </span>
              </Tooltip>
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
              <SearchableSelect
                fullWidth
                label="Adaptar para o produto"
                placeholder="Buscar produto…"
                value={selecao}
                onChange={(valor) => {
                  setSelecao(valor);
                  setEscolhido(
                    products.find((p) => `cat:${p.id}` === valor) ?? null,
                  );
                }}
                onSearchChange={setBusca}
                loading={buscando}
                emptyLabel="Nenhum — só analisar a estrutura"
                sx={{ mt: 1, mb: 0.5 }}
                options={[
                  ...meusProdutos
                    .filter((p) =>
                      p.name.toLowerCase().includes(busca.trim().toLowerCase()),
                    )
                    .map((p) => ({
                      value: `meu:${p.id}`,
                      label: p.name,
                      imageUrl: p.images[0] ?? null,
                      caption: p.benefit ?? undefined,
                      group: 'Meus produtos',
                    })),
                  ...(escolhido && !products.some((p) => p.id === escolhido.id)
                    ? [escolhido, ...products]
                    : products
                  ).map((p) => ({
                    value: `cat:${p.id}`,
                    label: p.title,
                    imageUrl: p.imageUrl ? proxyImage(p.imageUrl) : null,
                    caption: [p.storeName, p.category]
                      .filter(Boolean)
                      .join(' · '),
                    group: 'Catálogo da plataforma',
                  })),
                ]}
              />

              {error && (
                <Alert severity="error" sx={{ mt: 1 }}>
                  {error}
                </Alert>
              )}
              {/* Trava por saldo antes do clique — o <span> é o que permite o
                  Tooltip explicar um botão desabilitado. */}
              <Tooltip title={saldoAnalise.motivo}>
                <span>
                  <Button
                    fullWidth
                    variant="contained"
                    startIcon={<AutoAwesomeRoundedIcon />}
                    disabled={
                      analyzing || !transcript.trim() || saldoAnalise.insuficiente
                    }
                    onClick={handleAnalyze}
                    sx={{ mt: 2 }}
                  >
                    {analyzing ? 'Analisando...' : 'Analisar e gerar roteiro'}
                  </Button>
                </span>
              </Tooltip>
              {saldoAnalise.insuficiente && (
                <Button
                  component={Link}
                  to="/planos"
                  fullWidth
                  variant="outlined"
                  sx={{ mt: 1.5 }}
                >
                  {saldoAnalise.semPlano ? 'Assinar um plano' : 'Comprar créditos'}
                </Button>
              )}
            </CardContent>
          </Card>
        </Grid>

        <Grid item xs={12} md={7}>
          {analyzing && <BrandLoader label="Decompondo o vídeo..." />}
          {result && !analyzing && (
            <Card>
              <CardContent>
                <Box display="flex" justifyContent="space-between" alignItems="flex-start" gap={1}>
                  <Typography variant="h6" sx={{ minWidth: 0, wordBreak: 'break-word' }}>{result.productName}</Typography>
                  <IconButton
                    size="small"
                    onClick={() =>
                      navigator.clipboard.writeText(result.content)
                    }
                    aria-label="copiar"
                    sx={{ flexShrink: 0 }}
                  >
                    <ContentCopyIcon fontSize="small" />
                  </IconButton>
                </Box>
                <Typography
                  component="pre"
                  variant="body2"
                  sx={{ whiteSpace: 'pre-wrap', fontFamily: 'inherit', wordBreak: 'break-word' }}
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
                p: { xs: 3, md: 6 },
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
      {dialogo}
    </>
  );
}
