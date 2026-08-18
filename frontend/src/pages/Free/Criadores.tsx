import { Alert, Avatar, Box, Card, Chip, Grid, Stack, Typography } from '@mui/material';
import { useEffect, useState } from 'react';
import { BrandLoader } from '@/components/ui/BrandLoader';
import { freeService, type FreeSnapshot } from '@/services/free.service';
import { FreeBanner, RodapeBloqueado } from './components';

/**
 * Criadores, na conta gratuita (`docs/CONTA-FREE.md`).
 *
 * A amostra aqui é a CAUDA do ranking, e não o topo — cinco perfis reais, os de
 * menor faturamento entre os que coletamos. O motivo é o que esta tela vende:
 * quem paga não quer "criadores", quer saber QUEM está faturando muito no nicho
 * dele. Entregar os cinco primeiros seria entregar a resposta; a cauda mostra
 * que a base existe e como é a ficha, e deixa o ranking do outro lado do
 * paywall.
 *
 * Sem GMV e sem vendas, pelo mesmo motivo. Seguidores em faixa.
 */
export function FreeCriadoresPage() {
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

  if (erro) return <Alert severity="error">{erro}</Alert>;
  if (!snapshot) return <BrandLoader label="Carregando..." />;

  return (
    <Box>
      <Typography variant="h5" fontWeight={800} mb={0.5}>
        Criadores
      </Typography>
      <Typography color="text.secondary" mb={3}>
        Perfis que vendem no TikTok Shop.
      </Typography>

      <FreeBanner
        refreshAt={snapshot.refreshAt}
        descricao={`Você está vendo ${snapshot.creators.length} criadores da amostra gratuita.`}
      />

      <Grid container spacing={2}>
        {snapshot.creators.map((c) => (
          <Grid item xs={12} sm={6} md={4} key={c.id}>
            <Card variant="outlined" sx={{ borderRadius: 3, p: 2, height: '100%' }}>
              <Stack direction="row" spacing={2} alignItems="center">
                <Avatar src={c.avatarUrl ?? undefined} sx={{ width: 56, height: 56 }}>
                  {c.name?.[0] ?? c.handle?.[1]}
                </Avatar>
                <Box minWidth={0}>
                  <Typography fontWeight={800} noWrap>
                    {c.name || c.handle}
                  </Typography>
                  <Typography variant="body2" color="text.secondary" noWrap>
                    {c.handle}
                  </Typography>
                  <Stack direction="row" spacing={1} mt={1} alignItems="center">
                    <Chip label={c.category} size="small" />
                    {/* Faixa: a ordem de grandeza sem o número exato. */}
                    <Typography variant="body2" color="text.secondary">
                      {c.followersRange} seguidores
                    </Typography>
                  </Stack>
                </Box>
              </Stack>
            </Card>
          </Grid>
        ))}
      </Grid>

      <RodapeBloqueado tipo="criadores" exibidos={snapshot.creators.length} />
    </Box>
  );
}
