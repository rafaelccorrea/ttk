import ArrowBackRoundedIcon from '@mui/icons-material/ArrowBackRounded';
import LockRoundedIcon from '@mui/icons-material/LockRounded';
import TrendingDownRoundedIcon from '@mui/icons-material/TrendingDownRounded';
import TrendingUpRoundedIcon from '@mui/icons-material/TrendingUpRounded';
import {
  Box,
  Button,
  Chip,
  Grid,
  Paper,
  Stack,
  Typography,
} from '@mui/material';
import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { BrandLoader } from '@/components/ui/BrandLoader';
import { SmartImage } from '@/components/ui/SmartImage';
import { freeService, type FreeProduct } from '@/services/free.service';

/*
 * Cada linha nomeia o que falta — vago não vende upgrade. E nenhuma delas pode
 * citar roteiro, análise ou imagem: a conta gratuita já tem essas ferramentas
 * (limitadas pelo saldo), e oferecer de volta o que ela usa hoje faz o plano
 * parecer não acrescentar nada.
 */
const TRAVADOS = [
  'Loja e link de compra do produto',
  'Vendas e receita exatas no período',
  'Evolução dia a dia (7, 30 e 90 dias)',
  'Criadores e vídeos que anunciam este produto',
  'O catálogo inteiro, com busca e filtros',
];

/**
 * Detalhe do produto na amostra gratuita (`docs/CONTA-FREE.md`).
 *
 * O backend responde 403 para qualquer id fora da amostra — inclusive para ids
 * que existem no catálogo. Aqui isso vira uma tela de upgrade em vez de um erro:
 * quem chegou por um link antigo ou por um id copiado não bateu num bug, bateu
 * no limite do plano, e a tela precisa dizer isso.
 *
 * A lista do que está travado é explícita de propósito. "Assine para ver mais"
 * não informa nada; nomear a loja, a série diária e os criadores mostra a
 * distância exata entre o que ele tem e o que ele compraria.
 */
export function FreeProdutoDetalhePage() {
  const { id } = useParams<{ id: string }>();
  const [produto, setProduto] = useState<FreeProduct | null>(null);
  const [foraDaAmostra, setForaDaAmostra] = useState(false);

  useEffect(() => {
    if (!id) return;
    let ativo = true;
    setProduto(null);
    setForaDaAmostra(false);
    freeService
      .product(id)
      .then((p) => ativo && setProduto(p))
      .catch(() => ativo && setForaDaAmostra(true));
    return () => {
      ativo = false;
    };
  }, [id]);

  if (foraDaAmostra) {
    return (
      <Paper
        variant="outlined"
        sx={{
          p: { xs: 4, md: 8 },
          borderRadius: 4,
          borderStyle: 'dashed',
          textAlign: 'center',
          maxWidth: 560,
          mx: 'auto',
          mt: 6,
        }}
      >
        <LockRoundedIcon sx={{ fontSize: 44, color: '#fe2c55', mb: 1 }} />
        <Typography variant="h6" fontWeight={800} mb={0.5}>
          Este produto está fora da amostra gratuita
        </Typography>
        <Typography color="text.secondary" mb={2.5}>
          Sua conta vê uma seleção fixa de produtos. Com um plano você abre o
          catálogo inteiro, com busca, filtros e o histórico de cada produto.
        </Typography>
        <Stack direction="row" spacing={1.5} justifyContent="center">
          <Button component={Link} to="/produtos" variant="outlined">
            Voltar à amostra
          </Button>
          <Button component={Link} to="/planos" variant="contained">
            Ver planos
          </Button>
        </Stack>
      </Paper>
    );
  }

  if (!produto) return <BrandLoader label="Carregando o produto..." />;

  return (
    <Box>
      <Button
        component={Link}
        to="/produtos"
        startIcon={<ArrowBackRoundedIcon />}
        sx={{ mb: 2 }}
      >
        Voltar
      </Button>

      <Grid container spacing={3}>
        <Grid item xs={12} md={5}>
          <Box
            sx={{
              position: 'relative',
              pt: '100%',
              borderRadius: 3,
              overflow: 'hidden',
            }}
          >
            <Box sx={{ position: 'absolute', inset: 0 }}>
              <SmartImage src={produto.imageUrl} alt={produto.title} />
            </Box>
          </Box>
        </Grid>

        <Grid item xs={12} md={7}>
          <Chip label={produto.category} size="small" sx={{ mb: 1.5 }} />
          <Typography variant="h5" fontWeight={800} mb={1}>
            {produto.title}
          </Typography>
          <Typography variant="h6" fontWeight={800} mb={2}>
            {produto.price.toLocaleString('pt-BR', {
              style: 'currency',
              currency: 'BRL',
            })}
          </Typography>

          <Stack direction="row" spacing={3} mb={3}>
            <Box>
              <Typography variant="body2" color="text.secondary">
                Vendas em 30 dias
              </Typography>
              <Typography fontWeight={800}>{produto.salesRange}</Typography>
            </Box>
            {produto.growthPct !== null && (
              <Box>
                <Typography variant="body2" color="text.secondary">
                  Crescimento
                </Typography>
                <Stack direction="row" spacing={0.5} alignItems="center">
                  {produto.growthPct >= 0 ? (
                    <TrendingUpRoundedIcon fontSize="small" color="success" />
                  ) : (
                    <TrendingDownRoundedIcon fontSize="small" color="error" />
                  )}
                  <Typography
                    fontWeight={800}
                    color={produto.growthPct >= 0 ? 'success.main' : 'error.main'}
                  >
                    {produto.growthPct > 0 ? '+' : ''}
                    {produto.growthPct}%
                  </Typography>
                </Stack>
              </Box>
            )}
          </Stack>

          <Paper
            variant="outlined"
            sx={{ p: 2.5, borderRadius: 3, borderStyle: 'dashed' }}
          >
            <Typography fontWeight={800} mb={1.5}>
              No plano Essencial você também vê:
            </Typography>
            <Stack spacing={1} mb={2.5}>
              {TRAVADOS.map((item) => (
                <Stack key={item} direction="row" spacing={1} alignItems="center">
                  <LockRoundedIcon fontSize="small" sx={{ color: '#fe2c55' }} />
                  <Typography variant="body2" color="text.secondary">
                    {item}
                  </Typography>
                </Stack>
              ))}
            </Stack>
            <Button component={Link} to="/planos" variant="contained" fullWidth>
              Ver planos
            </Button>
          </Paper>
        </Grid>
      </Grid>
    </Box>
  );
}
