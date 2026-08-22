import { LockRounded, TrendingUpRounded } from '@mui/icons-material';
import {
  Box,
  Button,
  Chip,
  Container,
  Grid,
  Skeleton,
  Stack,
  Typography,
} from '@mui/material';
import { useEffect, useState } from 'react';
import { Link as RouterLink } from 'react-router-dom';
import {
  showcaseService,
  type ShowcaseSnapshot,
} from '@/services/showcase.service';
import {
  Reveal,
  SectionHeading,
  cyanDeep,
  glass,
  line,
  page,
  red,
  textDim,
  textFaint,
  textMain,
} from './theme';

/**
 * A prova de valor da landing — o que ficou no lugar da conta gratuita.
 *
 * O PikPok cobra na entrada, então o visitante precisa ver dado real ANTES de
 * pagar. O que ele vê aqui vem mesmo do banco (não é mockup), mas capado de
 * propósito no backend: 8 produtos, vendas em faixa, defasado, e sem a loja nem
 * o link do TikTok. A tensão é explícita na própria seção — mostrar que o dado
 * existe e deixar claro o que está coberto é mais honesto, e converte melhor,
 * do que um print bonito de tela.
 *
 * Se a API falhar, a seção some inteira: landing sem uma seção é melhor que
 * landing com um erro.
 */
export function LiveSample() {
  const [data, setData] = useState<ShowcaseSnapshot | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let active = true;
    showcaseService
      .snapshot()
      .then((d) => active && setData(d))
      .catch(() => active && setFailed(true));
    return () => {
      active = false;
    };
  }, []);

  if (failed) return null;

  return (
    <Box sx={{ borderBottom: `1px solid ${line}` }}>
      <Container maxWidth={false} sx={{ ...page, py: { xs: 9, md: 12 } }}>
        <Reveal>
          <SectionHeading
            eyebrow="DADOS DE VERDADE"
            title="Uma amostra do radar, sem cadastro"
            subtitle={
              data
                ? `Estes produtos saíram do nosso banco agora — de ${data.stats.products.toLocaleString('pt-BR')} rastreados em ${data.stats.categories} categorias. A amostra tem ${data.delayDays} dias de atraso e esconde loja, receita e link.`
                : 'Produtos reais, direto do banco do PikPok.'
            }
          />
        </Reveal>

        <Reveal>
          <Grid container spacing={2.5}>
            {(data?.products ?? Array.from({ length: 8 })).map((p, i) => (
              <Grid item xs={6} sm={4} md={3} key={data ? (p as never as { id: string }).id : i}>
                {data ? (
                  <ProductCard product={p as ShowcaseSnapshot['products'][0]} />
                ) : (
                  <Skeleton
                    variant="rounded"
                    height={260}
                    sx={{ borderRadius: 3 }}
                  />
                )}
              </Grid>
            ))}
          </Grid>
        </Reveal>

        <Reveal>
          <Stack alignItems="center" spacing={2} mt={5}>
            <Stack
              direction="row"
              spacing={1}
              alignItems="flex-start"
              sx={{ color: textFaint, maxWidth: 560, px: { xs: 1, sm: 0 } }}
            >
              <LockRounded sx={{ fontSize: 16, flexShrink: 0, mt: '2px' }} />
              <Typography fontSize={14} sx={{ minWidth: 0, textAlign: { xs: 'left', sm: 'center' } }}>
                Loja, receita, link do TikTok, histórico diário e busca ficam
                dentro da plataforma.
              </Typography>
            </Stack>
            <Button
              component={RouterLink}
              to="/planos"
              variant="contained"
              size="large"
              sx={{ borderRadius: 999, px: 4, fontWeight: 800, maxWidth: '100%', textAlign: 'center' }}
            >
              Destravar o radar completo
            </Button>
          </Stack>
        </Reveal>
      </Container>
    </Box>
  );
}

function ProductCard({
  product,
}: {
  product: ShowcaseSnapshot['products'][0];
}) {
  const growth = product.growthPct;
  return (
    <Box
      sx={{
        ...glass,
        borderRadius: 3,
        overflow: 'hidden',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      <Box
        sx={{
          aspectRatio: '1 / 1',
          bgcolor: 'rgba(8,9,15,0.04)',
          backgroundImage: product.imageUrl
            ? `url(${product.imageUrl})`
            : undefined,
          backgroundSize: 'cover',
          backgroundPosition: 'center',
        }}
      />
      <Stack spacing={1} p={{ xs: 1.25, sm: 1.75 }} flexGrow={1} sx={{ minWidth: 0 }}>
        <Typography
          fontSize={13.5}
          fontWeight={700}
          color={textMain}
          sx={{
            display: '-webkit-box',
            WebkitLineClamp: 2,
            WebkitBoxOrient: 'vertical',
            overflow: 'hidden',
            overflowWrap: 'anywhere',
          }}
        >
          {product.title}
        </Typography>
        <Typography fontSize={12} color={textFaint}>
          {product.category}
        </Typography>
        <Box flexGrow={1} />
        <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
          <Chip
            label={`${product.salesRange} vendas`}
            size="small"
            sx={{ fontWeight: 700, fontSize: 11.5 }}
          />
          {growth !== null && (
            <Stack direction="row" spacing={0.5} alignItems="center">
              <TrendingUpRounded
                sx={{ fontSize: 15, color: growth >= 0 ? cyanDeep : red }}
              />
              <Typography
                fontSize={12.5}
                fontWeight={800}
                color={growth >= 0 ? cyanDeep : red}
              >
                {growth >= 0 ? '+' : ''}
                {growth}%
              </Typography>
            </Stack>
          )}
        </Stack>
        <Typography fontSize={13} color={textDim} fontWeight={700}>
          R$ {product.price.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
        </Typography>
      </Stack>
    </Box>
  );
}
