import {
  Alert,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Stack,
  Typography,
} from '@mui/material';
import { useEffect, useState } from 'react';
import type { TermoDeEnvio } from '@shared/desktop-api';
import { obterPonte } from '../ponte';

/**
 * O aviso que aparece UMA vez, antes do primeiro envio automático da conta.
 *
 * O que este diálogo está fazendo, sem rodeio: pedindo permissão para o app
 * digitar e postar mensagens no chat da live COM A CONTA DO VENDEDOR, sabendo
 * que isso contraria os Termos do TikTok e que a conta que pode ser restringida
 * é a dele. É a decisão mais cara que este produto pede, e por isso ela é
 * apresentada como decisão — não como um passo do fluxo.
 *
 * SEM DARK PATTERN, E É REGRA
 * ---------------------------
 * Os dois botões têm o mesmo peso visual e o mesmo tamanho. Nada de "recusar"
 * como link cinza no canto, nada de foco automático no aceitar, nada de
 * contagem regressiva. Um aviso de risco desenhado para ser aceito no piloto
 * automático não é aviso nenhum — e, do lado prático, recusar aqui deixa o app
 * COMPLETO no modo painel, que é o produto que já funcionava ontem. Quem
 * recusa não perde nada além do envio.
 *
 * O texto vem do servidor (`GET /live/termo-envio-automatico`) porque o aceite
 * é gravado com a versão do que foi lido; ver `TermoDeEnvio`.
 */
export function DialogoTermoDeEnvio({
  aberto,
  aoAceitar,
  aoRecusar,
}: {
  readonly aberto: boolean;
  /** Chamado depois de o backend confirmar o aceite. */
  readonly aoAceitar: () => void;
  readonly aoRecusar: () => void;
}): JSX.Element {
  const ponte = obterPonte();
  const [termo, setTermo] = useState<TermoDeEnvio | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  useEffect(() => {
    if (!aberto || !ponte) return;
    setErro(null);
    ponte
      .obterTermoDeEnvio()
      .then(setTermo)
      .catch((e: Error) => setErro(e.message));
  }, [aberto, ponte]);

  const aceitar = async (): Promise<void> => {
    if (!ponte || !termo) return;
    setEnviando(true);
    setErro(null);
    try {
      await ponte.aceitarTermoDeEnvio(termo.versao);
      aoAceitar();
    } catch (e) {
      // Falhar aqui NÃO liga nada: sem o registro no servidor o modo automático
      // continua barrado, e a tela precisa dizer isso em vez de seguir adiante.
      setErro((e as Error).message);
    } finally {
      setEnviando(false);
    }
  };

  return (
    <Dialog open={aberto} onClose={aoRecusar} maxWidth="sm" fullWidth>
      <DialogTitle sx={{ fontWeight: 800, pb: 1 }}>
        O PikPok vai escrever no chat por você
      </DialogTitle>

      <DialogContent>
        <Stack spacing={1.5}>
          <Typography variant="body1" fontWeight={700}>
            Ligando o automático, o app digita e envia mensagens no chat da sua
            live, na sua conta, sem te perguntar antes de cada uma.
          </Typography>

          <Typography variant="body2" color="text.secondary">
            O TikTok não permite postar comentário por robô. Se eles perceberem,
            quem pode ser bloqueado ou perder a conta é você — não o PikPok.
            Nós reduzimos o ritmo, respeitamos um teto por minuto e paramos
            sozinhos ao primeiro sinal de problema, mas não conseguimos garantir
            que nada aconteça.
          </Typography>

          <Typography variant="body2" color="text.secondary">
            Você pode desligar quando quiser, na chave da barra de baixo ou com
            Ctrl + Shift + P, mesmo com a janela do TikTok na frente.
          </Typography>

          {/*
            O texto oficial fica DEPOIS do resumo, e não no lugar dele: quem lê
            entende o risco nas três linhas acima; quem quiser a redação
            registrada (é ela que o aceite carimba) continua tendo acesso.
          */}
          {termo ? (
            <Typography
              variant="caption"
              color="text.secondary"
              sx={{ whiteSpace: 'pre-line', display: 'block', pt: 0.5 }}
            >
              {termo.texto}
            </Typography>
          ) : erro ? null : (
            <Stack direction="row" alignItems="center" spacing={1}>
              <CircularProgress size={16} />
              <Typography variant="caption" color="text.secondary">
                Carregando o aviso completo…
              </Typography>
            </Stack>
          )}

          {erro ? <Alert severity="error">{erro}</Alert> : null}
        </Stack>
      </DialogContent>

      {/*
        Mesmo tamanho, mesma altura, lado a lado. A ordem coloca o "não" antes
        porque é o caminho que não muda nada na conta de ninguém.
      */}
      <DialogActions sx={{ px: 3, pb: 2.5, gap: 1 }}>
        <Button
          fullWidth
          size="large"
          variant="outlined"
          color="inherit"
          onClick={aoRecusar}
        >
          Não, continuar só no painel
        </Button>
        <Button
          fullWidth
          size="large"
          variant="contained"
          disabled={!termo || enviando}
          onClick={() => void aceitar()}
        >
          {enviando ? 'Registrando…' : 'Entendi o risco, pode enviar'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
