import { useCallback, useRef, useState } from 'react';
import {
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  Stack,
  useMediaQuery,
  useTheme,
} from '@mui/material';
import WarningAmberRoundedIcon from '@mui/icons-material/WarningAmberRounded';

/**
 * A confirmação de uma ação que não dá para desfazer.
 *
 * Substitui o `window.confirm`, e o motivo não é estética. A caixa nativa é
 * desenhada pelo sistema operacional, não pelo produto: ela chega com a fonte
 * do Chrome, o nome do domínio no topo e dois botões cinzentos idênticos — o de
 * apagar tem exatamente o mesmo peso visual do de cancelar, no momento em que a
 * diferença entre os dois é a base de conhecimento inteira de uma live. Pior:
 * ela TRAVA a thread do navegador enquanto está aberta, o que congela o polling
 * das lives em processamento por trás dela, e o navegador oferece ao usuário um
 * "não deixe este site abrir mais caixas" que desliga a confirmação de vez —
 * silenciosamente, para todas as próximas.
 *
 * Aqui o botão destrutivo é vermelho e nomeia o que faz ("Apagar"), o texto
 * pode explicar a consequência em mais de uma linha, e no celular o diálogo
 * ocupa a tela inteira em vez de virar uma tirinha ilegível.
 */
export interface ConfirmDialogProps {
  aberto: boolean;
  titulo: string;
  /** O que vai acontecer, em uma frase. É onde mora a consequência. */
  mensagem?: string;
  /** O verbo da ação, no botão. "Apagar", "Tirar da base" — nunca "OK". */
  textoConfirmar?: string;
  textoCancelar?: string;
  /** Vermelho e com ícone de aviso. Ligado por padrão: quase tudo aqui apaga. */
  destrutivo?: boolean;
  onConfirmar: () => void;
  onCancelar: () => void;
}

export function ConfirmDialog({
  aberto,
  titulo,
  mensagem,
  textoConfirmar = 'Confirmar',
  textoCancelar = 'Cancelar',
  destrutivo = true,
  onConfirmar,
  onCancelar,
}: ConfirmDialogProps) {
  const theme = useTheme();
  const noCelular = useMediaQuery(theme.breakpoints.down('sm'));

  return (
    <Dialog
      open={aberto}
      onClose={onCancelar}
      fullWidth
      maxWidth="xs"
      fullScreen={noCelular}
      /*
       * O foco começa em Cancelar de propósito. Quem chega aqui com o dedo já
       * no Enter — o caminho mais comum de um clique acidental — não apaga
       * nada: para destruir é preciso mirar no botão vermelho.
       */
      PaperProps={{ sx: { borderRadius: noCelular ? 0 : 3 } }}
    >
      <DialogTitle sx={{ fontWeight: 800 }}>
        <Stack direction="row" alignItems="center" spacing={1.25}>
          {destrutivo && <WarningAmberRoundedIcon color="error" />}
          <span>{titulo}</span>
        </Stack>
      </DialogTitle>
      {mensagem && (
        <DialogContent>
          <DialogContentText sx={{ color: 'text.secondary' }}>
            {mensagem}
          </DialogContentText>
        </DialogContent>
      )}
      <DialogActions sx={{ px: 3, pb: 2.5, pt: mensagem ? 0 : 1, flexWrap: 'wrap', gap: 1 }}>
        <Button onClick={onCancelar} autoFocus>
          {textoCancelar}
        </Button>
        <Button
          variant="contained"
          color={destrutivo ? 'error' : 'primary'}
          onClick={onConfirmar}
          disableElevation
        >
          {textoConfirmar}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

/** O que se pede ao hook: os mesmos textos do diálogo, sem os callbacks. */
type PedidoDeConfirmacao = Omit<
  ConfirmDialogProps,
  'aberto' | 'onConfirmar' | 'onCancelar'
>;

/**
 * O `window.confirm` de volta em forma de promessa — sem as caixas do sistema.
 *
 * A forma importa: trocar a caixa nativa por um diálogo obriga, normalmente, a
 * partir cada função de apagar em duas (uma que abre, outra que executa) e a
 * carregar o item escolhido num estado à parte. Isso é muito conserto para um
 * problema de aparência, e todo lugar que esquecesse metade da reforma ficaria
 * apagando sem perguntar. Com a promessa, `if (!window.confirm(...))` vira
 * `if (!(await confirmar(...)))` e o resto da função continua exatamente como
 * estava.
 *
 *     const { confirmar, dialogoDeConfirmacao } = useConfirmacao();
 *     ...
 *     if (!(await confirmar({ titulo: 'Apagar?' }))) return;
 *     ...
 *     return <>{dialogoDeConfirmacao}</>;
 */
export function useConfirmacao() {
  const [pedido, setPedido] = useState<PedidoDeConfirmacao | null>(null);
  const responder = useRef<((ok: boolean) => void) | null>(null);

  const confirmar = useCallback((novo: PedidoDeConfirmacao): Promise<boolean> => {
    return new Promise<boolean>((resolve) => {
      /*
       * Se já houver um pedido aberto, o anterior é respondido com "não" antes
       * de ser substituído: uma promessa pendurada para sempre deixaria a
       * função que a espera parada no meio, segurando o que quer que ela
       * estivesse fazendo.
       */
      responder.current?.(false);
      responder.current = resolve;
      setPedido(novo);
    });
  }, []);

  const fechar = useCallback((ok: boolean) => {
    responder.current?.(ok);
    responder.current = null;
    setPedido(null);
  }, []);

  const dialogoDeConfirmacao = (
    <ConfirmDialog
      aberto={pedido !== null}
      titulo={pedido?.titulo ?? ''}
      mensagem={pedido?.mensagem}
      textoConfirmar={pedido?.textoConfirmar}
      textoCancelar={pedido?.textoCancelar}
      destrutivo={pedido?.destrutivo}
      onConfirmar={() => fechar(true)}
      onCancelar={() => fechar(false)}
    />
  );

  return { confirmar, dialogoDeConfirmacao };
}
