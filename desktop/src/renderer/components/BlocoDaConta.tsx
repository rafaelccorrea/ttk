import LogoutIcon from '@mui/icons-material/Logout';
import PersonIcon from '@mui/icons-material/PersonOutline';
import {
  Box,
  Button,
  Chip,
  CircularProgress,
  Stack,
  Typography,
  alpha,
} from '@mui/material';
import { useEffect, useState } from 'react';
import type { SessaoDesktop } from '@shared/desktop-api';
import { cores } from '../theme/theme';
import { obterPonte } from '../ponte';

/**
 * De quem é esta conta, e como sair dela.
 *
 * POR QUE ELE APARECE EM DUAS TELAS
 * ---------------------------------
 * Sair morava só nos Ajustes, e na prática isso era o mesmo que não existir: a
 * tela de conectar tinha um botão cinza "Ajustes" no rodapé, e o logout ficava
 * um nível abaixo dele. Quem abre o app na conta errada — o caso real é o
 * computador compartilhado da loja, ou quem ativou com a conta pessoal — não
 * procura "ajustes" para trocar de conta; procura o próprio e-mail na tela.
 *
 * Então o e-mail passa a ficar VISÍVEL na tela de conectar, que é onde o
 * vendedor está parado antes de entrar no ar, e é ali mesmo que ele sai. Os
 * Ajustes continuam com a versão completa, para quem foi procurar lá.
 *
 * A confirmação é a mesma nos dois lugares e existe por UM caso: sair no meio
 * de uma live encerra a run. Fora dele o clique não perde nada — por isso ela é
 * um painel inline e não um diálogo que toma a tela.
 */
export function BlocoDaConta({
  aoSair,
  variante = 'completo',
}: {
  /** Chamado depois de o token ser esquecido: o shell volta para a ativação. */
  readonly aoSair: () => void;
  /** `compacto` é a faixa de uma linha; `completo` é o cartão dos Ajustes. */
  readonly variante?: 'completo' | 'compacto';
}): JSX.Element | null {
  const ponte = obterPonte();
  const [sessao, setSessao] = useState<SessaoDesktop | null>(null);
  const [confirmando, setConfirmando] = useState(false);
  const [saindo, setSaindo] = useState(false);
  /**
   * Se há uma transmissão no ar agora.
   *
   * Só existe para o aviso de que sair encerra a live. Avisar sempre seria
   * gastar o alarme à toa: fora do ar, sair não custa nada, e um aviso que
   * aparece quando não há risco é o que ensina o vendedor a ignorar o aviso que
   * aparece quando há.
   */
  const [emLive, setEmLive] = useState(false);

  useEffect(() => {
    // A sessão é só para MOSTRAR de quem é a conta antes de sair dela. Se a
    // leitura falhar, o bloco ainda aparece com o botão: não saber o e-mail não
    // pode impedir alguém de deslogar.
    if (!ponte) return undefined;
    void ponte.obterSessao().then(setSessao).catch(() => undefined);
    void ponte
      .obterConexao()
      .then((c) => setEmLive(c.status === 'ativa' || c.status === 'pausada'))
      .catch(() => undefined);
    return ponte.aoMudarConexao((c) =>
      setEmLive(c.status === 'ativa' || c.status === 'pausada'),
    );
  }, [ponte]);

  if (!ponte) return null;

  const sair = async (): Promise<void> => {
    setSaindo(true);
    try {
      await ponte.sair();
    } finally {
      // Mesmo se o encerramento da run falhar, o token local já foi esquecido:
      // segurar o vendedor nesta tela o deixaria preso numa conta da qual ele
      // acabou de pedir para sair.
      setSaindo(false);
      aoSair();
    }
  };

  const confirmacao = (
    <Stack spacing={1.25} sx={{ mt: 1.25 }}>
      {/*
        O texto precisa dizer as DUAS coisas que este botão faz, porque só uma
        delas está no rótulo. Sair devolve o app à tela de ativação, que já
        nasce pedindo um código novo — ou seja, este É o caminho de trocar de
        conta, e quem procurava por isso não tinha como adivinhar que estava
        atrás de um botão escrito "sair".
      */}
      <Typography variant="body2" color="text.secondary" sx={{ lineHeight: 1.55 }}>
        Este computador se desconecta da conta e volta para a tela de ativação.
        O <strong>login do TikTok também é apagado</strong> daqui, para ninguém
        entrar na sua conta depois de você. Para{' '}
        <strong>entrar com outra conta</strong>, é só aprovar o código novo com
        ela. Seus minutos e suas bases não são afetados.
      </Typography>
      {emLive ? (
        <Typography variant="body2" sx={{ lineHeight: 1.55, color: cores.erro }}>
          A live que está no ar vai ser encerrada.
        </Typography>
      ) : null}
      <Stack direction="row" spacing={1}>
        <Button
          size="small"
          variant="contained"
          color="error"
          onClick={() => void sair()}
          disabled={saindo}
          startIcon={saindo ? <CircularProgress size={14} color="inherit" /> : null}
        >
          {saindo ? 'Saindo…' : 'Sair e trocar de conta'}
        </Button>
        <Button
          size="small"
          color="inherit"
          onClick={() => setConfirmando(false)}
          disabled={saindo}
        >
          Cancelar
        </Button>
      </Stack>
    </Stack>
  );

  if (variante === 'compacto') {
    return (
      <Box
        sx={{
          px: 1.5,
          py: 1,
          borderRadius: 3,
          bgcolor: alpha('#ffffff', 0.03),
          border: '1px solid',
          borderColor: 'divider',
        }}
      >
        <Stack direction="row" alignItems="center" spacing={1}>
          <PersonIcon sx={{ fontSize: 17, color: 'text.secondary', flexShrink: 0 }} />
          <Typography
            variant="caption"
            noWrap
            sx={{ minWidth: 0, flex: 1, color: 'text.secondary' }}
          >
            {sessao?.email ?? 'computador ativado'}
          </Typography>
          {!confirmando ? (
            <Button
              size="small"
              color="inherit"
              startIcon={<LogoutIcon sx={{ fontSize: 15 }} />}
              onClick={() => setConfirmando(true)}
              sx={{ flexShrink: 0, py: 0.25 }}
            >
              Sair
            </Button>
          ) : null}
        </Stack>
        {confirmando ? confirmacao : null}
      </Box>
    );
  }

  return (
    <Box
      sx={{
        mt: 1,
        p: 2,
        borderRadius: 3,
        bgcolor: cores.superficie,
        border: '1px solid',
        borderColor: 'divider',
      }}
    >
      <Typography variant="overline" color="text.secondary">
        conta
      </Typography>

      <Stack direction="row" alignItems="center" spacing={1} sx={{ mt: 0.5, mb: 1.75 }}>
        <PersonIcon sx={{ fontSize: 18, color: 'text.secondary' }} />
        <Typography variant="body2" fontWeight={650} noWrap sx={{ minWidth: 0 }}>
          {sessao?.email ?? 'Este computador está ativado.'}
        </Typography>
        {sessao?.plano ? (
          <Chip size="small" variant="outlined" label={sessao.plano} sx={{ flexShrink: 0 }} />
        ) : null}
      </Stack>

      {confirmando ? (
        confirmacao
      ) : (
        <Stack spacing={1} alignItems="flex-start">
          <Button
            size="small"
            variant="outlined"
            color="inherit"
            startIcon={<LogoutIcon sx={{ fontSize: 16 }} />}
            onClick={() => setConfirmando(true)}
          >
            Sair da conta
          </Button>
          {/*
            Esta linha existe porque "trocar de conta" não é um botão separado —
            é a consequência deste. Sem dizê-lo aqui, quem quer usar o app com
            outra conta procura um item que não existe e conclui que não dá.
          */}
          <Typography variant="caption" color="text.secondary">
            É por aqui que você troca de conta neste computador.
          </Typography>
        </Stack>
      )}
    </Box>
  );
}
