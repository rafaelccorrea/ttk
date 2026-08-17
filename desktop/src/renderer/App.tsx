import { Box, Stack, Tooltip, Typography, alpha } from '@mui/material';
import { useCallback, useEffect, useState } from 'react';
import type { EstadoConexao } from '@shared/desktop-api';
import { Carregando } from './components/Estados';
import { Logo } from './components/Logo';
import { cores } from './theme/theme';
import { obterPonte } from './ponte';
import { Ativacao } from './screens/Ativacao';
import { Cockpit } from './screens/Cockpit';
import { ConectarLive } from './screens/ConectarLive';
import { Configuracoes } from './screens/Configuracoes';

/**
 * O shell do painel.
 *
 * Ocupa os 40% da direita da janela — os 60% da esquerda são a BrowserView do
 * TikTok, que o processo principal posiciona por cima deste documento. Por
 * isso o layout aqui NÃO se ancora na largura da tela: qualquer `100vw` some
 * atrás da view.
 *
 * NÃO HÁ ROTEADOR. Não é economia de dependência: a tela do app não é um
 * histórico que se navega, é um ESTADO — ou o computador não está ativado, ou
 * está e não há live, ou há uma live no ar. Um roteador colocaria "voltar" onde
 * voltar não existe (voltar da live conectada para a tela de conectar deixaria
 * uma run rodando atrás de uma tela que diz que não há nenhuma). Os ajustes são
 * a única exceção, e por isso são uma sobreposição, não uma rota.
 */
type Tela = 'carregando' | 'ativacao' | 'conectar' | 'cockpit';

export function App(): JSX.Element {
  const ponte = obterPonte();
  const [tela, setTela] = useState<Tela>('carregando');
  const [nosAjustes, setNosAjustes] = useState(false);
  const [versao, setVersao] = useState<string>('');

  const decidirTela = useCallback(async (): Promise<void> => {
    if (!ponte) {
      // Sem ponte não há sessão para consultar. A tela de ativação é onde a
      // mensagem sobre o app não ter subido inteiro já está escrita.
      setTela('ativacao');
      return;
    }
    try {
      const sessao = await ponte.obterSessao();
      if (!sessao) {
        setTela('ativacao');
        return;
      }
      const conexao = await ponte.obterConexao();
      setTela(emLive(conexao) ? 'cockpit' : 'conectar');
    } catch {
      setTela('ativacao');
    }
  }, [ponte]);

  useEffect(() => {
    void decidirTela();
    // A ponte pode não existir se o painel for aberto fora do Electron (num
    // `vite dev` solto, por exemplo). Degradar em silêncio é melhor do que
    // derrubar a tela por causa do rodapé.
    ponte?.obterVersao().then(setVersao).catch(() => undefined);
  }, [ponte, decidirTela]);

  useEffect(() => {
    if (!ponte) return undefined;
    // Quem sabe que a autorização saiu é o processo principal, que faz o
    // polling do token. A tela de ativação mostra o desfecho; a troca de tela é
    // aqui, porque é o shell que decide onde o app está.
    return ponte.aoMudarAtivacao((estado) => {
      if (estado.status === 'aprovada') void decidirTela();
    });
  }, [ponte, decidirTela]);

  useEffect(() => {
    if (!ponte) return undefined;
    // A live pode cair sem o painel ter pedido nada (internet, saldo, o TikTok
    // encerrando a transmissão). Quem descobre isso é o processo principal, e é
    // ele quem manda o painel sair do cockpit.
    return ponte.aoMudarConexao((conexao) => {
      setTela((atual) => {
        if (atual === 'ativacao' || atual === 'carregando') return atual;
        return emLive(conexao) ? 'cockpit' : atual;
      });
    });
  }, [ponte]);

  return (
    <Box
      sx={{
        // 40% da direita: o restante é a BrowserView.
        marginLeft: '60%',
        height: '100vh',
        display: 'flex',
        flexDirection: 'column',
        color: 'text.primary',
        overflow: 'hidden',
        position: 'relative',
        bgcolor: 'background.default',
        /*
         * Um halo da marca no topo do painel, apagando para o preto na
         * primeira dobra. É o que impede os 40% de virarem um retângulo chapado
         * ao lado do vídeo — e ele mora no ::before para não interceptar clique.
         */
        '&::before': {
          content: '""',
          position: 'absolute',
          inset: 0,
          pointerEvents: 'none',
          background: `radial-gradient(120% 55% at 100% 0%, ${alpha(
            cores.vermelho,
            0.14,
          )} 0%, transparent 60%), radial-gradient(90% 45% at 0% 0%, ${alpha(
            cores.ciano,
            0.07,
          )} 0%, transparent 55%)`,
        },
        // Todo o conteúdo sobe acima do halo.
        '& > *': { position: 'relative', zIndex: 1 },
      }}
    >
      {/* Uma linha de 2px com o gradiente da marca costurando o painel à
          janela. É a única área onde os dois tons da marca aparecem juntos. */}
      <Box sx={{ height: 2, background: cores.gradiente, flexShrink: 0 }} />

      <Stack
        direction="row"
        alignItems="center"
        spacing={1.25}
        sx={{ px: 2.25, pt: 1.75, pb: 0.5, flexShrink: 0 }}
      >
        <Logo tamanho={30} brilhando={false} />
        <Stack sx={{ minWidth: 0 }}>
          <Typography variant="subtitle1" fontWeight={800} noWrap lineHeight={1.2}>
            Copiloto ao vivo
          </Typography>
          <Typography variant="caption" color="text.secondary" noWrap>
            PikPok {versao}
          </Typography>
        </Stack>
        <Box sx={{ flex: 1 }} />
        {/*
          O selo do modo somente-painel some do cabeçalho e vira este ponto com
          rótulo: no cockpit quem manda a verdade sobre envio é a barra de
          baixo, e dois lugares dizendo o mesmo se contradiriam na hora em que
          o vendedor ligasse o automático.
        */}
        <Tooltip title="Nada é publicado no chat do TikTok sem você ligar o envio automático.">
          <Stack
            direction="row"
            alignItems="center"
            spacing={0.75}
            sx={{
              px: 1.25,
              py: 0.5,
              borderRadius: 999,
              border: '1px solid',
              borderColor: alpha(cores.ciano, 0.28),
              bgcolor: alpha(cores.ciano, 0.08),
              flexShrink: 0,
            }}
          >
            <Box
              sx={{
                width: 6,
                height: 6,
                borderRadius: '50%',
                bgcolor: cores.ciano,
                boxShadow: `0 0 8px ${cores.ciano}`,
              }}
            />
            <Typography variant="caption" fontWeight={700} color={cores.ciano}>
              seguro
            </Typography>
          </Stack>
        </Tooltip>
      </Stack>

      <Box sx={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
        {nosAjustes ? (
          <Configuracoes
            aoVoltar={() => setNosAjustes(false)}
            // Sair fecha os ajustes JUNTO com a troca de tela: deixar a
            // sobreposição aberta mostraria os sliders de um copiloto que não
            // tem mais conta por trás.
            aoSair={() => {
              setNosAjustes(false);
              setTela('ativacao');
            }}
          />
        ) : tela === 'carregando' ? (
          <Carregando texto="Abrindo o copiloto…" />
        ) : tela === 'ativacao' ? (
          <Ativacao />
        ) : tela === 'conectar' ? (
          <ConectarLive
            aoConectar={() => setTela('cockpit')}
            aoAbrirConfiguracoes={() => setNosAjustes(true)}
          />
        ) : (
          <Cockpit
            aoAbrirConfiguracoes={() => setNosAjustes(true)}
            aoEncerrar={() => setTela('conectar')}
          />
        )}
      </Box>

      <Typography
        variant="caption"
        color="text.secondary"
        sx={{
          px: 2.25,
          py: 0.85,
          flexShrink: 0,
          fontSize: 11,
          opacity: 0.65,
          borderTop: '1px solid',
          borderColor: 'divider',
        }}
      >
        Nada é publicado no chat do TikTok sem a sua permissão.
      </Typography>
    </Box>
  );
}

/** A run está de pé o bastante para o cockpit fazer sentido. */
function emLive(conexao: EstadoConexao): boolean {
  return (
    conexao.status === 'ativa' ||
    conexao.status === 'conectando' ||
    conexao.status === 'pausada' ||
    conexao.status === 'sem_saldo'
  );
}
