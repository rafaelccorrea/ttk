import { Box, Chip, Stack, Typography } from '@mui/material';
import { useCallback, useEffect, useState } from 'react';
import type { EstadoConexao } from '@shared/desktop-api';
import { Carregando } from './components/Estados';
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
        bgcolor: 'background.default',
        overflow: 'hidden',
      }}
    >
      <Stack
        direction="row"
        alignItems="center"
        spacing={1}
        sx={{ px: 2, pt: 1.5, flexShrink: 0 }}
      >
        <Typography variant="h6">Copiloto ao vivo</Typography>
        <Chip size="small" color="primary" variant="outlined" label="somente painel" />
      </Stack>

      <Box sx={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
        {nosAjustes ? (
          <Configuracoes aoVoltar={() => setNosAjustes(false)} />
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
        sx={{ px: 2, py: 0.75, flexShrink: 0 }}
      >
        PikPok Copiloto {versao} · nada é publicado no chat do TikTok
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
