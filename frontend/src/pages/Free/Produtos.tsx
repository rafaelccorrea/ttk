import StarRoundedIcon from '@mui/icons-material/StarRounded';
import StarBorderRoundedIcon from '@mui/icons-material/StarBorderRounded';
import TrendingDownRoundedIcon from '@mui/icons-material/TrendingDownRounded';
import TrendingUpRoundedIcon from '@mui/icons-material/TrendingUpRounded';
import {
  Alert,
  Box,
  Card,
  CardActionArea,
  Chip,
  Grid,
  IconButton,
  Stack,
  Typography,
} from '@mui/material';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { BrandLoader } from '@/components/ui/BrandLoader';
import { SmartImage } from '@/components/ui/SmartImage';
import { freeService, type FreeSnapshot } from '@/services/free.service';
import { ControlesTravados, FreeBanner, RodapeBloqueado } from './components';

/**
 * Produtos, para quem ainda não assina (`docs/CONTA-FREE.md`).
 *
 * É a mesma plataforma, com uma amostra fixa: os mesmos itens para todas as
 * contas gratuitas, congelados por 7 dias. Não há paginação, scroll infinito,
 * busca ou filtro — não por simplicidade, mas porque é isso que separa uma
 * vitrine de uma ferramenta.
 *
 * O card mostra faixa de vendas em vez do número exato e não traz loja nem link
 * de compra. É deliberado: é exatamente esse dado que se paga para ter.
 */
export function FreeProdutosPage() {
  const [snapshot, setSnapshot] = useState<FreeSnapshot | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    let ativo = true;
    freeService
      .sample()
      .then((s) => ativo && setSnapshot(s))
      .catch(
        () =>
          ativo &&
          setErro('Não foi possível carregar a amostra. Tente novamente em instantes.'),
      );
    return () => {
      ativo = false;
    };
  }, []);

  /**
   * Favoritar dentro da amostra.
   *
   * A lista é atualizada na hora, sem refazer a chamada: são 20 itens em
   * memória e a resposta do servidor só confirma o que já sabemos. Se falhar,
   * o estado volta — melhor uma estrela que pisca do que uma que mente.
   */
  async function alternarFavorito(id: string) {
    setSnapshot((atual) =>
      atual
        ? {
            ...atual,
            products: atual.products.map((p) =>
              p.id === id ? { ...p, isFavorite: !p.isFavorite } : p,
            ),
          }
        : atual,
    );
    try {
      await freeService.alternarFavorito(id);
    } catch {
      setSnapshot((atual) =>
        atual
          ? {
              ...atual,
              products: atual.products.map((p) =>
                p.id === id ? { ...p, isFavorite: !p.isFavorite } : p,
              ),
            }
          : atual,
      );
    }
  }

  if (erro) return <Alert severity="error">{erro}</Alert>;
  if (!snapshot) return <BrandLoader label="Carregando a amostra..." />;

  return (
    <Box>
      <Typography variant="h5" fontWeight={800} mb={0.5}>
        Produtos que vendem
      </Typography>
      <Typography color="text.secondary" mb={3}>
        Uma seleção do que está vendendo no TikTok Shop agora.
      </Typography>

      <FreeBanner
        refreshAt={snapshot.refreshAt}
        descricao={`Você está vendo ${snapshot.products.length} de ${snapshot.limits.products} produtos da amostra gratuita.`}
      />
      <ControlesTravados />

      <Grid container spacing={2}>
        {snapshot.products.map((p) => (
          <Grid item xs={12} sm={6} md={4} lg={3} key={p.id}>
            <Card
              variant="outlined"
              sx={{ borderRadius: 3, height: '100%', position: 'relative' }}
            >
              {/* Fora do CardActionArea: dentro dele, o clique na estrela
                  navegaria para o detalhe junto de favoritar. */}
              <IconButton
                aria-label={p.isFavorite ? 'Remover dos favoritos' : 'Favoritar'}
                onClick={() => alternarFavorito(p.id)}
                size="small"
                sx={{
                  position: 'absolute',
                  top: 8,
                  right: 8,
                  zIndex: 1,
                  bgcolor: 'rgba(255,255,255,0.92)',
                  '&:hover': { bgcolor: '#fff' },
                }}
              >
                {p.isFavorite ? (
                  <StarRoundedIcon fontSize="small" sx={{ color: '#fe2c55' }} />
                ) : (
                  <StarBorderRoundedIcon fontSize="small" />
                )}
              </IconButton>
              <CardActionArea
                component={Link}
                to={`/produtos/${p.id}`}
                sx={{ height: '100%' }}
              >
                <Box sx={{ position: 'relative', pt: '100%' }}>
                  <Box sx={{ position: 'absolute', inset: 0 }}>
                    <SmartImage src={p.imageUrl} alt={p.title} />
                  </Box>
                </Box>
                <Box sx={{ p: 1.75 }}>
                  <Chip label={p.category} size="small" sx={{ mb: 1 }} />
                  <Typography
                    fontWeight={700}
                    sx={{
                      display: '-webkit-box',
                      WebkitLineClamp: 2,
                      WebkitBoxOrient: 'vertical',
                      overflow: 'hidden',
                      minHeight: 44,
                    }}
                  >
                    {p.title}
                  </Typography>
                  <Stack
                    direction="row"
                    alignItems="center"
                    justifyContent="space-between"
                    sx={{ mt: 1 }}
                  >
                    <Typography fontWeight={800}>
                      {p.price.toLocaleString('pt-BR', {
                        style: 'currency',
                        currency: 'BRL',
                      })}
                    </Typography>
                    {/* Faixa, nunca o número exato — é o que se vende. */}
                    <Typography variant="body2" color="text.secondary">
                      {p.salesRange} vendas
                    </Typography>
                  </Stack>
                  {/* Queda em verde e com seta para cima lia como alta — o
                      sinal do número dizia uma coisa e a cor, outra. */}
                  {p.growthPct !== null && (
                    <Stack direction="row" spacing={0.5} alignItems="center" mt={0.5}>
                      {p.growthPct >= 0 ? (
                        <TrendingUpRoundedIcon fontSize="small" color="success" />
                      ) : (
                        <TrendingDownRoundedIcon fontSize="small" color="error" />
                      )}
                      <Typography
                        variant="body2"
                        color={p.growthPct >= 0 ? 'success.main' : 'error.main'}
                        fontWeight={700}
                      >
                        {p.growthPct > 0 ? '+' : ''}
                        {p.growthPct}% em 30 dias
                      </Typography>
                    </Stack>
                  )}
                </Box>
              </CardActionArea>
            </Card>
          </Grid>
        ))}
      </Grid>

      <RodapeBloqueado tipo="produtos" exibidos={snapshot.products.length} />
    </Box>
  );
}
