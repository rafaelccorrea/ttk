import StarRoundedIcon from '@mui/icons-material/StarRounded';
import {
  Alert,
  Box,
  Button,
  Card,
  CardActionArea,
  Chip,
  Grid,
  IconButton,
  Paper,
  Stack,
  Typography,
} from '@mui/material';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { BrandLoader } from '@/components/ui/BrandLoader';
import { SmartImage } from '@/components/ui/SmartImage';
import { freeService, type FreeProduct } from '@/services/free.service';

/**
 * Favoritos, na conta gratuita (`docs/CONTA-FREE.md`).
 *
 * Favoritar é a única escrita que a conta gratuita faz no catálogo, e está
 * liberada porque custa uma linha no banco e cria hábito — a pessoa volta para
 * ver a própria lista, e é dessa volta que sai a assinatura.
 *
 * A lista mostra só o que está na amostra VIGENTE. Um produto favoritado numa
 * semana sai daqui quando a amostra troca, e isso é dito na tela em vez de
 * parecer que a lista sumiu: sem esse corte, favoritar viraria um jeito de
 * acumular 20 produtos por semana e o limite deixaria de existir.
 */
export function FreeFavoritosPage() {
  const [itens, setItens] = useState<FreeProduct[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    let ativo = true;
    freeService
      .favoritos()
      .then((f) => ativo && setItens(f))
      .catch(
        () =>
          ativo &&
          setErro('Não foi possível carregar seus favoritos. Tente novamente.'),
      );
    return () => {
      ativo = false;
    };
  }, []);

  async function desfavoritar(id: string) {
    setItens((atual) => (atual ? atual.filter((p) => p.id !== id) : atual));
    try {
      await freeService.alternarFavorito(id);
    } catch {
      // Falhou: recarrega do servidor, que é a fonte da verdade.
      freeService.favoritos().then(setItens).catch(() => undefined);
    }
  }

  if (erro) return <Alert severity="error">{erro}</Alert>;
  if (!itens) return <BrandLoader label="Carregando..." />;

  return (
    <Box>
      <Typography variant="h5" fontWeight={800} mb={0.5}>
        Favoritos
      </Typography>
      <Typography color="text.secondary" mb={3}>
        Os produtos da amostra que você marcou.
      </Typography>

      {itens.length === 0 ? (
        /*
         * Tela vazia com caminho, não tela em branco: ela diz o que fazer e
         * para onde ir. Uma lista vazia sem saída lê como recurso quebrado.
         */
        <Paper
          variant="outlined"
          sx={{
            p: { xs: 4, md: 6 },
            borderRadius: 4,
            borderStyle: 'dashed',
            textAlign: 'center',
            maxWidth: 520,
            mx: 'auto',
            mt: 4,
          }}
        >
          <StarRoundedIcon sx={{ fontSize: 44, color: '#fe2c55', mb: 1 }} />
          <Typography variant="h6" fontWeight={800} mb={0.5}>
            Nenhum favorito ainda
          </Typography>
          <Typography color="text.secondary" mb={2.5}>
            Toque na estrela de um produto da amostra para guardá-lo aqui e
            acompanhar enquanto ele estiver na seleção da semana.
          </Typography>
          <Button component={Link} to="/produtos" variant="contained">
            Ver a amostra
          </Button>
        </Paper>
      ) : (
        <>
          <Typography variant="body2" color="text.secondary" mb={2}>
            A seleção gratuita troca a cada 7 dias — quando isso acontece, os
            favoritos que saírem da amostra deixam de aparecer aqui.
          </Typography>
          <Grid container spacing={2}>
            {itens.map((p) => (
              <Grid item xs={12} sm={6} md={4} lg={3} key={p.id}>
                <Card
                  variant="outlined"
                  sx={{ borderRadius: 3, height: '100%', position: 'relative' }}
                >
                  <IconButton
                    aria-label="Remover dos favoritos"
                    onClick={() => desfavoritar(p.id)}
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
                    <StarRoundedIcon fontSize="small" sx={{ color: '#fe2c55' }} />
                  </IconButton>
                  <CardActionArea component={Link} to={`/produtos/${p.id}`}>
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
                        justifyContent="space-between"
                        sx={{ mt: 1 }}
                      >
                        <Typography fontWeight={800}>
                          {p.price.toLocaleString('pt-BR', {
                            style: 'currency',
                            currency: 'BRL',
                          })}
                        </Typography>
                        <Typography variant="body2" color="text.secondary">
                          {p.salesRange} vendas
                        </Typography>
                      </Stack>
                    </Box>
                  </CardActionArea>
                </Card>
              </Grid>
            ))}
          </Grid>
        </>
      )}
    </Box>
  );
}
