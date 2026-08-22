import { useEffect, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Card,
  Chip,
  Stack,
  Typography,
} from '@mui/material';
import DownloadRoundedIcon from '@mui/icons-material/DownloadRounded';
import DesktopWindowsRoundedIcon from '@mui/icons-material/DesktopWindowsRounded';
import { DownloadDoApp, liveService } from '@/services/live.service';

/**
 * O convite para baixar o app de desktop.
 *
 * Ele existe porque, sem ele, o produto tem uma metade invisível: a base de
 * conhecimento é montada aqui na web, mas quem responde o chat durante a
 * transmissão é o aplicativo — e o vendedor não tinha por onde descobrir que ele
 * existe, muito menos como obtê-lo.
 *
 * Duas decisões de honestidade, e as duas custam conversão de propósito:
 *
 *  1. Enquanto não há instalador publicado, o card diz "em breve" em vez de
 *     mostrar um botão. Botão que baixa 404 é pior do que ausência de botão —
 *     o primeiro queima confiança, o segundo só não ajuda.
 *  2. Quando o instalador não é assinado, o aviso do SmartScreen do Windows é
 *     anunciado AQUI, antes do download. Descobrir aquela tela azul no meio da
 *     instalação faz o vendedor achar que baixou vírus; ler antes que vai
 *     acontecer transforma o susto em expectativa.
 */
/**
 * O visitante está num celular ou tablet?
 *
 * A pergunta importa porque o instalador é um `.exe`/`.dmg`: no telefone o
 * download não instala nada — a pessoa baixa 200MB, não consegue abrir e
 * conclui que o produto quebrou. Melhor dizer a verdade ("é no computador")
 * do que entregar um botão que só funciona pela metade.
 *
 * User agent com `iPad` explícito: o Safari do iPadOS se apresenta como Mac,
 * e a pista que sobra é ser "Mac" com tela de toque.
 */
function emDispositivoMovel(): boolean {
  const ua = navigator.userAgent;
  if (/Android|iPhone|iPad|iPod|Mobile/i.test(ua)) return true;
  return /Macintosh/i.test(ua) && navigator.maxTouchPoints > 1;
}

export function CardDoApp({ paraQuem }: { paraQuem: 'lista' | 'detalhe' }) {
  const [info, setInfo] = useState<DownloadDoApp | null>(null);
  const mobile = emDispositivoMovel();

  useEffect(() => {
    let vivo = true;
    liveService
      .getDownload()
      .then((r) => {
        if (vivo) setInfo(r);
      })
      // Falha aqui não merece alarme na tela: o card é um complemento, e a
      // ausência dele não impede ninguém de montar a base de conhecimento.
      .catch(() => undefined);
    return () => {
      vivo = false;
    };
  }, []);

  if (!info) return null;

  const naoAssinado = info.disponivel && !info.assinado;

  return (
    <Card
      sx={{
        position: 'relative',
        overflow: 'hidden',
        p: { xs: 2, md: 2.5 },
        mb: 3,
        // Uma faixa da marca na lateral: este card não é mais um item da lista,
        // é a metade que falta do produto. Sem algum peso visual ele lê como
        // banner e o olho pula direto para as bases.
        '&::before': {
          content: '""',
          position: 'absolute',
          left: 0,
          top: 0,
          bottom: 0,
          width: 3,
          background: 'linear-gradient(180deg, #fe2c55 0%, #00c2bb 100%)',
        },
      }}
    >
      <Stack
        direction={{ xs: 'column', md: 'row' }}
        spacing={2}
        alignItems={{ md: 'center' }}
      >
        {/*
          O LOGO, e não um ícone genérico de monitor.
          Este card entrega um instalador: o que a pessoa vê aqui é o que ela
          vai procurar na barra de tarefas depois, e um desenho de computador
          não ajuda a reconhecer nada. O ícone do app é a própria arte abaixo.
        */}
        <Box sx={{ position: 'relative', flexShrink: 0, width: 48, height: 48 }}>
          <Box
            component="img"
            src="/icon-192.png"
            alt=""
            sx={{
              width: 48,
              height: 48,
              borderRadius: 2.5,
              display: 'block',
              boxShadow: '0 6px 20px rgba(254,44,85,0.20)',
            }}
          />
          {/* O selo de "isto é um programa de computador" fica como emblema no
              canto: informa a plataforma sem tomar o lugar da marca. */}
          <Box
            sx={{
              position: 'absolute',
              right: -5,
              bottom: -5,
              width: 22,
              height: 22,
              borderRadius: '50%',
              display: 'grid',
              placeItems: 'center',
              bgcolor: 'background.paper',
              border: '1px solid',
              borderColor: 'divider',
            }}
          >
            <DesktopWindowsRoundedIcon sx={{ fontSize: 12, color: 'text.secondary' }} />
          </Box>
        </Box>

        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Stack direction="row" spacing={1} alignItems="center" mb={0.5} flexWrap="wrap" useFlexGap>
            <Typography variant="subtitle1" fontWeight={800} sx={{ minWidth: 0 }}>
              {paraQuem === 'detalhe'
                ? 'Falta o app para usar esta base ao vivo'
                : 'O copiloto que fica com você na live'}
            </Typography>
            {paraQuem === 'detalhe' && (
              <Chip
                size="small"
                label="Passo 2 de 2"
                sx={{ fontWeight: 700, bgcolor: 'rgba(254,44,85,0.1)', color: '#fe2c55' }}
              />
            )}
            {info.versao && (
              <Chip size="small" variant="outlined" label={`v${info.versao}`} />
            )}
          </Stack>
          {/*
           * "Precisa", não "pode". O navegador não tem como escrever no chat do
           * TikTok — isso exige a sessão logada do vendedor, na máquina dele —,
           * então o app não é uma versão a mais do produto: é a única forma de a
           * base virar resposta ao vivo. Uma frase que soe opcional aqui produz
           * o suporte de segunda-feira: "montei a base e não respondeu nada".
           */}
          <Typography variant="body2" color="text.secondary">
            {paraQuem === 'detalhe'
              ? 'A base está pronta. Para ela responder o chat durante a transmissão você precisa do aplicativo de computador — é ele que abre o TikTok com a sua conta e escreve por você. Pelo navegador não dá.'
              : 'A base é montada aqui. Durante a transmissão, quem lê o chat e responde é o aplicativo de computador — ele precisa do TikTok aberto na mesma máquina.'}
          </Typography>
        </Box>

        {mobile ? (
          // No celular o botão some de propósito: o instalador não abre em
          // Android/iOS, e um download que não instala vira chamado de suporte.
          <Chip
            label="Baixe pelo computador"
            sx={{ fontWeight: 700, flexShrink: 0, alignSelf: { xs: 'flex-start', md: 'center' } }}
          />
        ) : info.disponivel ? (
          <Stack spacing={1} sx={{ flexShrink: 0 }}>
            {info.windows && (
              <Button
                variant="contained"
                startIcon={<DownloadRoundedIcon />}
                href={info.windows}
                // Download é navegação para fora: sem isto, um clique no meio de
                // um upload em andamento trocaria a página e mataria o envio.
                target="_blank"
                rel="noopener"
              >
                Baixar para Windows
              </Button>
            )}
            {info.mac && (
              <Button
                variant="outlined"
                startIcon={<DownloadRoundedIcon />}
                href={info.mac}
                target="_blank"
                rel="noopener"
              >
                Baixar para Mac
              </Button>
            )}
          </Stack>
        ) : (
          <Chip
            label="Disponível em breve"
            sx={{ fontWeight: 700, flexShrink: 0, alignSelf: { xs: 'flex-start', md: 'center' } }}
          />
        )}
      </Stack>

      {mobile && info.disponivel && (
        <Alert severity="info" sx={{ mt: 2 }}>
          Você está num celular. O aplicativo do copiloto é um programa de{' '}
          <strong>computador</strong> (Windows ou Mac) — abra esta página no seu
          computador para baixar. A base de conhecimento você pode montar por
          aqui normalmente.
        </Alert>
      )}

      {naoAssinado && !mobile && (
        <Alert severity="info" sx={{ mt: 2 }}>
          Na instalação o Windows vai avisar que não reconhece o programa. É
          esperado: clique em <strong>Mais informações</strong> e depois em{' '}
          <strong>Executar assim mesmo</strong>.
        </Alert>
      )}
    </Card>
  );
}
