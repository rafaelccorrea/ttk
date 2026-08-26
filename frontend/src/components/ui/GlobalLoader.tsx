import { Box, keyframes, Link, Stack, Typography } from '@mui/material';
import CheckRoundedIcon from '@mui/icons-material/CheckRounded';
import ScheduleRoundedIcon from '@mui/icons-material/ScheduleRounded';
import { ReactNode, useEffect, useRef, useState } from 'react';
import { Link as RouterLink } from 'react-router-dom';

export interface EtapaDoLoader {
  label: string;
  icone?: ReactNode;
}

export interface GlobalLoaderProps {
  /** 'completo' = título + barra + timeline; 'leve' = só a marca pulsando. */
  variante?: 'completo' | 'leve';
  /** Cobre a tela inteira. Padrão: true no 'leve', false no 'completo'. */
  fullScreen?: boolean;
  titulo?: string;
  etapas?: EtapaDoLoader[];
  /** Índice da etapa em andamento (0-based). */
  etapaAtual?: number;
  /** 0–100. Se ausente, interpola suavemente até o teto da etapa atual. */
  progresso?: number;
  /** Ex.: "10 min". */
  tempoEstimado?: string;
  /** Texto do "Enquanto isso: …". */
  dica?: string;
  /** Rota do link "Explorar →". */
  linkExplorar?: string;
  mostrarAvisoEmail?: boolean;
  /** Atualiza o título da aba: "(2/5) Etapa — PikPok". */
  atualizarTituloDaAba?: boolean;
}

const girar = keyframes`to { transform: rotate(360deg); }`;
const pontos = keyframes`
  0%, 20% { opacity: 0; }
  50%, 100% { opacity: 1; }
`;
const pulso = keyframes`
  0%, 100% { opacity: 1; }
  50% { opacity: 0.7; }
`;

const GRADIENTE = 'linear-gradient(90deg, #7c3aed 0%, #fe2c55 60%, #25f4ee 100%)';

/**
 * Progresso "vivo": mesmo sem evento do backend a barra anda devagar até o
 * teto da etapa atual (sem nunca voltar). Quando `progresso` vem de fora, ele
 * manda — e também só sobe.
 */
function useProgressoInterpolado(
  externo: number | undefined,
  etapaAtual: number,
  totalEtapas: number,
) {
  const [valor, setValor] = useState(() => externo ?? 0);
  const ref = useRef(valor);

  useEffect(() => {
    if (externo !== undefined) {
      const alvo = Math.max(ref.current, Math.min(100, Math.max(0, externo)));
      ref.current = alvo;
      setValor(alvo);
      return;
    }
    const total = Math.max(1, totalEtapas);
    const piso = (etapaAtual / total) * 100;
    // Teto fica um pouco abaixo do início da próxima etapa: ela nunca "termina" sozinha.
    const teto = etapaAtual >= total - 1 ? 97 : ((etapaAtual + 1) / total) * 100 - 2;
    if (ref.current < piso) {
      ref.current = piso;
      setValor(piso);
    }
    const id = setInterval(() => {
      const faltam = teto - ref.current;
      if (faltam <= 0.05) return;
      // Ease-out: anda rápido no início da etapa e quase para perto do teto.
      const proximo = ref.current + Math.max(0.03, faltam * 0.025);
      ref.current = Math.min(teto, proximo);
      setValor(ref.current);
    }, 400);
    return () => clearInterval(id);
  }, [externo, etapaAtual, totalEtapas]);

  return valor;
}

function Reticencias() {
  return (
    <Box component="span" aria-hidden sx={{ display: 'inline-flex', ml: 0.25 }}>
      {[0, 1, 2].map((i) => (
        <Box
          key={i}
          component="span"
          sx={{
            animation: `${pontos} 1.4s ease-in-out ${i * 0.2}s infinite`,
            '@media (prefers-reduced-motion: reduce)': { animation: 'none' },
          }}
        >
          .
        </Box>
      ))}
    </Box>
  );
}

export interface LoaderLeveProps {
  fullScreen?: boolean;
  /** Texto pequeno abaixo da marca (ex.: "Carregando produtos…"). */
  label?: string;
  /** Altura mínima quando não cobre a tela. */
  minHeight?: number | string;
}

/** Marca "PikPok…" pulsando. É o loader padrão do app: rotas, gates e dados de página. */
export function LoaderLeve({ fullScreen = false, label, minHeight = 240 }: LoaderLeveProps) {
  return (
    <Box
      role="status"
      aria-label={label ?? 'Carregando'}
      sx={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 1.5,
        ...(fullScreen
          ? {
              position: 'fixed',
              inset: 0,
              zIndex: (t) => t.zIndex.modal + 1,
              bgcolor: 'background.default',
            }
          : { minHeight, width: '100%' }),
      }}
    >
      <Typography
        sx={{
          fontSize: fullScreen ? 40 : 30,
          fontWeight: 800,
          letterSpacing: '-0.03em',
          lineHeight: 1,
          color: 'text.primary',
          animation: `${pulso} 1.8s ease-in-out infinite`,
          '@media (prefers-reduced-motion: reduce)': { animation: 'none' },
        }}
      >
        Pik
        <Box component="span" sx={{ color: 'primary.main' }}>
          Pok
        </Box>
        <Reticencias />
      </Typography>
      {label && (
        <Typography variant="body2" color="text.secondary">
          {label}
        </Typography>
      )}
    </Box>
  );
}

const VarianteLeve = LoaderLeve;

function Circulo({ estado, indice, icone }: { estado: 'feita' | 'atual' | 'futura'; indice: number; icone?: ReactNode }) {
  const base = {
    width: 32,
    height: 32,
    borderRadius: '50%',
    display: 'grid',
    placeItems: 'center',
    flexShrink: 0,
    fontSize: 13,
    fontWeight: 700,
  } as const;
  if (estado === 'feita') {
    return (
      <Box sx={{ ...base, background: GRADIENTE, color: '#fff' }}>
        <CheckRoundedIcon sx={{ fontSize: 18 }} />
      </Box>
    );
  }
  if (estado === 'atual') {
    return (
      <Box sx={{ ...base, position: 'relative', color: 'primary.main' }}>
        <Box
          sx={{
            position: 'absolute',
            inset: 0,
            borderRadius: '50%',
            border: '2px solid',
            borderColor: 'rgba(254,44,85,0.2)',
            borderTopColor: 'primary.main',
            animation: `${girar} 0.9s linear infinite`,
            '@media (prefers-reduced-motion: reduce)': { animation: 'none' },
          }}
        />
        <Box sx={{ display: 'grid', placeItems: 'center', '& svg': { fontSize: 16 } }}>{icone ?? indice + 1}</Box>
      </Box>
    );
  }
  return (
    <Box sx={{ ...base, border: '2px solid', borderColor: 'divider', color: 'text.disabled' }}>
      {indice + 1}
    </Box>
  );
}

export function GlobalLoader({
  variante = 'completo',
  fullScreen,
  titulo = 'Estamos preparando tudo…',
  etapas = [],
  etapaAtual = 0,
  progresso,
  tempoEstimado,
  dica,
  linkExplorar,
  mostrarAvisoEmail = false,
  atualizarTituloDaAba = true,
}: GlobalLoaderProps) {
  const cobrir = fullScreen ?? variante === 'leve';
  const atual = Math.min(Math.max(0, etapaAtual), Math.max(0, etapas.length - 1));
  const valor = useProgressoInterpolado(progresso, atual, etapas.length);

  useEffect(() => {
    if (!atualizarTituloDaAba || variante !== 'completo' || etapas.length === 0) return;
    const anterior = document.title;
    document.title = `(${atual + 1}/${etapas.length}) ${etapas[atual].label} — PikPok`;
    return () => {
      document.title = anterior;
    };
  }, [atualizarTituloDaAba, variante, etapas, atual]);

  if (variante === 'leve') return <VarianteLeve fullScreen={cobrir} />;

  const pct = Math.round(valor);

  return (
    <Box
      role="status"
      aria-live="polite"
      aria-label={titulo}
      sx={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        ...(cobrir
          ? { position: 'fixed', inset: 0, zIndex: (t) => t.zIndex.modal + 1, bgcolor: 'background.default', p: 3 }
          : { width: '100%', py: 4, px: 2 }),
      }}
    >
      <Stack spacing={3} alignItems="center" sx={{ width: '100%', maxWidth: 440 }}>
        {tempoEstimado && (
          <Stack
            direction="row"
            spacing={0.75}
            alignItems="center"
            sx={{
              px: 1.5,
              py: 0.5,
              borderRadius: 99,
              border: '1px solid',
              borderColor: 'divider',
              bgcolor: 'action.hover',
              fontSize: 13,
              color: 'text.secondary',
            }}
          >
            <ScheduleRoundedIcon sx={{ fontSize: 16 }} />
            <span>
              Tempo estimado <strong style={{ color: 'inherit' }}>{tempoEstimado}</strong>
            </span>
          </Stack>
        )}

        <Typography variant="h5" sx={{ fontWeight: 800, textAlign: 'center', letterSpacing: '-0.02em' }}>
          {titulo}
        </Typography>

        <Box sx={{ width: '100%' }}>
          <Box sx={{ height: 6, borderRadius: 99, bgcolor: 'action.hover', overflow: 'hidden' }}>
            <Box
              sx={{
                height: '100%',
                width: `${valor}%`,
                borderRadius: 99,
                background: GRADIENTE,
                transition: 'width .5s ease',
              }}
            />
          </Box>
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', textAlign: 'center', mt: 0.75 }}>
            {pct}%
          </Typography>
        </Box>

        {etapas.length > 0 && (
          <Stack component="ol" sx={{ width: '100%', m: 0, p: 0, listStyle: 'none' }}>
            {etapas.map((e, i) => {
              const estado = i < atual ? 'feita' : i === atual ? 'atual' : 'futura';
              const ultima = i === etapas.length - 1;
              return (
                <Stack component="li" key={i} direction="row" spacing={1.5} aria-current={estado === 'atual' ? 'step' : undefined}>
                  <Stack alignItems="center">
                    <Circulo estado={estado} indice={i} icone={e.icone} />
                    {!ultima && (
                      <Box
                        sx={{
                          width: 2,
                          flex: 1,
                          minHeight: 20,
                          my: 0.5,
                          borderRadius: 1,
                          bgcolor: estado === 'feita' ? 'primary.main' : 'divider',
                          opacity: estado === 'feita' ? 0.6 : 1,
                        }}
                      />
                    )}
                  </Stack>
                  <Stack direction="row" spacing={1} alignItems="center" sx={{ height: 32, minWidth: 0 }}>
                    {estado !== 'atual' && e.icone && (
                      <Box sx={{ display: 'grid', color: estado === 'feita' ? 'text.secondary' : 'text.disabled', '& svg': { fontSize: 18 } }}>
                        {e.icone}
                      </Box>
                    )}
                    <Typography
                      sx={{
                        fontWeight: estado === 'atual' ? 700 : 500,
                        color: estado === 'atual' ? 'text.primary' : estado === 'feita' ? 'text.secondary' : 'text.disabled',
                      }}
                    >
                      {e.label}
                    </Typography>
                  </Stack>
                </Stack>
              );
            })}
          </Stack>
        )}

        {(dica || linkExplorar || mostrarAvisoEmail) && (
          <Stack spacing={1} alignItems="center" sx={{ textAlign: 'center' }}>
            {dica && (
              <Typography variant="body2" color="text.secondary">
                <strong>Enquanto isso:</strong> {dica}
              </Typography>
            )}
            {linkExplorar && (
              <Link component={RouterLink} to={linkExplorar} underline="hover" sx={{ fontWeight: 600 }}>
                Explorar →
              </Link>
            )}
            {mostrarAvisoEmail && (
              <Typography variant="caption" color="text.disabled">
                Pode fechar a página — avisamos por e-mail quando estiver pronto.
              </Typography>
            )}
          </Stack>
        )}
      </Stack>
    </Box>
  );
}
