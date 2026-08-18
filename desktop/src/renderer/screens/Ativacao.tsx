import { Box, Button, Stack, Typography, alpha } from '@mui/material';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { EstadoAtivacao } from '@shared/desktop-api';
import { Aviso, Carregando } from '../components/Estados';
import { Logo } from '../components/Logo';
import { mensagemDeErro } from '../erros';
import { cores } from '../theme/theme';
import { SEM_PONTE, obterPonte } from '../ponte';
import { useTikTokLogado } from '../hooks/useTikTokLogado';

/**
 * Tela 1 — ativação do aparelho.
 *
 * O vendedor NÃO digita e-mail e senha aqui, e isso não é economia de tela: o
 * login do PikPok é do Supabase, com provedores sociais e recuperação de senha
 * que já existem no site. Refazer tudo isso dentro de um Electron significaria
 * um segundo lugar onde a senha é digitada e um segundo lugar para errar. O
 * fluxo de dispositivo troca isso por um código de quatro caracteres: ele
 * aparece aqui, é aprovado na conta que ele já usa no navegador, e o app
 * recebe o token sem nunca ver a credencial.
 *
 * A tela é o código, grande, e um botão. Todo o resto é consequência.
 */
export function Ativacao({
  aposSair = false,
}: {
  /**
   * Se esta tela veio de um logout, e não da abertura do app.
   *
   * Faz diferença porque logo à esquerda o TikTok também acabou de ser
   * deslogado e está pedindo login. Nascer já com um código de ativação ali
   * coloca DOIS pedidos de entrar na tela ao mesmo tempo, e quem acabou de sair
   * não tem como saber qual dos dois é o da vez — ainda por cima queimando um
   * código de validade curta que talvez ninguém vá usar agora.
   *
   * Então depois de sair a tela é só a confirmação do que aconteceu, com o
   * código a um clique de distância.
   */
  readonly aposSair?: boolean;
}): JSX.Element {
  const ponte = obterPonte();
  /**
   * O passo 1 do onboarding: entrar no TikTok, à esquerda.
   *
   * Ele vem PRIMEIRO porque é o único que a pessoa faz no lugar onde ela já
   * sabe estar — o site que ela usa todo dia. Pedir o código do PikPok antes
   * colocava dois convites de login na mesma tela, um em cada metade, sem dizer
   * qual era qual; e o do PikPok ainda vence em poucos minutos enquanto ela
   * resolve o outro.
   */
  const tiktokLogado = useTikTokLogado();
  const [estado, setEstado] = useState<EstadoAtivacao | null>(null);
  const [pedindo, setPedindo] = useState(false);
  /**
   * Um código por montagem, e não por invocação de efeito.
   *
   * O `StrictMode` roda o efeito duas vezes em desenvolvimento, e cada volta
   * pedia um código novo: dois dos dez que a rota `/device/code` permite por
   * minuto iam embora em cada abertura do app, e algumas recargas depois a tela
   * de ativação passava a nascer com "muitas tentativas". O `ref` não é
   * paranoia de re-render — é o que mantém a cota alinhada com o que o vendedor
   * realmente pediu.
   */
  const jaPediu = useRef(false);

  const pedirCodigo = useCallback(async (): Promise<void> => {
    if (!ponte) return;
    setPedindo(true);
    try {
      setEstado(await ponte.iniciarAtivacao());
    } catch (erro) {
      setEstado({
        status: 'erro',
        userCode: null,
        verificationUrl: null,
        expiresIn: null,
        erro: mensagemDeErro(erro),
      });
    } finally {
      setPedindo(false);
    }
  }, [ponte]);

  useEffect(() => {
    if (!ponte) return undefined;
    // O desfecho da autorização chega pelo processo principal, que é quem faz o
    // polling do token: o painel não fica perguntando nada, só escuta.
    const cancelar = ponte.aoMudarAtivacao(setEstado);
    // O código só é pedido no passo 2, e nunca antes de o TikTok estar logado:
    // ele expira em minutos, e gerá-lo enquanto a pessoa ainda está digitando a
    // senha do TikTok ao lado é queimá-lo antes de alguém poder usá-lo.
    if (!jaPediu.current && !aposSair && tiktokLogado === true) {
      jaPediu.current = true;
      void pedirCodigo();
    }
    return cancelar;
  }, [ponte, pedirCodigo, aposSair, tiktokLogado]);

  if (!ponte) {
    return (
      <Moldura>
        <Aviso tom="erro" titulo="Não consegui iniciar a ativação" descricao={SEM_PONTE} />
      </Moldura>
    );
  }

  // A primeira leitura do login do TikTok ainda não voltou. É rápido, mas sem
  // este ramo a tela cairia no aviso de erro lá embaixo, que existe para
  // "não consegui gerar o código" — e ninguém pediu código nenhum ainda.
  if (tiktokLogado === null && !estado && !pedindo) {
    return (
      <Moldura>
        <Carregando texto="Conferindo o login do TikTok…" />
      </Moldura>
    );
  }

  /*
   * PASSO 1 — o login do TikTok, que é do lado de lá da tela.
   *
   * Enquanto ele não existe não há código nenhum aqui, e a tela diz uma coisa
   * só: entre ali. Era isto que faltava — o app abria pedindo um código de
   * ativação com o TikTok pedindo senha ao lado, dois logins simultâneos sem
   * ordem declarada, e nada explicando que são contas diferentes com funções
   * diferentes.
   */
  if (tiktokLogado === false) {
    return (
      <Moldura>
        <Stack spacing={2.5}>
          {aposSair ? (
            <Typography variant="body2" color="text.secondary" sx={{ lineHeight: 1.6 }}>
              Você saiu da conta do PikPok, e o login do TikTok foi apagado deste
              computador junto — por isso o site ao lado está pedindo para entrar
              de novo.
            </Typography>
          ) : null}
          <Passo numero={1} titulo="Entre na sua conta do TikTok" ativo>
            Use a tela do TikTok aqui ao lado, à esquerda. É essa conta que vai
            transmitir, e é dela que o copiloto lê as perguntas do chat.
          </Passo>
          <Passo numero={2} titulo="Ative este computador no PikPok">
            Depois do TikTok, aparece aqui um código para você aprovar na sua
            conta do PikPok. São contas diferentes: uma transmite, a outra
            responde.
          </Passo>
          <Stack direction="row" spacing={1} alignItems="center">
            <Box
              sx={{
                width: 7,
                height: 7,
                borderRadius: '50%',
                bgcolor: cores.atencao,
                animation: 'espera 1.6s ease-in-out infinite',
                '@keyframes espera': { '0%, 100%': { opacity: 1 }, '50%': { opacity: 0.25 } },
              }}
            />
            <Typography variant="caption" color="text.secondary">
              Assim que você entrar no TikTok, esta tela passa sozinha.
            </Typography>
          </Stack>
        </Stack>
      </Moldura>
    );
  }

  // O TikTok já está logado, mas a saída anterior segurou o código: ele custa
  // uma validade curta, e quem acabou de sair pode não ir usar o app agora.
  if (aposSair && !estado && !pedindo) {
    return (
      <Moldura>
        <Stack spacing={2.5}>
          <Typography variant="body2" color="text.secondary" sx={{ lineHeight: 1.6 }}>
            Você saiu da conta do PikPok. O TikTok ao lado continua logado — se
            for outra pessoa que vai transmitir, troque a conta por lá também.
          </Typography>
          <Button
            fullWidth
            size="large"
            variant="contained"
            onClick={() => void pedirCodigo()}
          >
            Gerar código de ativação
          </Button>
        </Stack>
      </Moldura>
    );
  }

  if (pedindo && !estado) {
    return (
      <Moldura>
        <Carregando texto="Gerando o seu código de ativação…" />
      </Moldura>
    );
  }

  if (!estado || estado.status === 'erro') {
    return (
      <Moldura>
        <Aviso
          tom="erro"
          titulo="Não consegui gerar o código"
          descricao={
            estado?.erro ??
            'Sem resposta do PikPok. Confira a sua internet e tente de novo.'
          }
          acao={{ rotulo: 'Tentar de novo', aoClicar: () => void pedirCodigo() }}
        />
      </Moldura>
    );
  }

  if (estado.status === 'negada' || estado.status === 'expirada') {
    const expirou = estado.status === 'expirada';
    return (
      <Moldura>
        <Aviso
          titulo={expirou ? 'Esse código venceu' : 'A autorização foi recusada'}
          descricao={
            expirou
              ? 'Os códigos duram poucos minutos por segurança. Gere outro e autorize em seguida.'
              : 'No site você clicou em recusar. Se foi engano, gere outro código e autorize.'
          }
          acao={{ rotulo: 'Gerar outro código', aoClicar: () => void pedirCodigo() }}
        />
      </Moldura>
    );
  }

  if (estado.status === 'aprovada') {
    return (
      <Moldura>
        <Carregando texto="Autorizado. Abrindo o copiloto…" />
      </Moldura>
    );
  }

  return (
    <Moldura>
      <Stack spacing={2.5}>
        <Typography variant="body2" color="text.secondary">
          A autorização acontece na mesma conta que você já usa no site do PikPok —
          aqui você não digita senha nenhuma.
        </Typography>

        <Box
          sx={{
            position: 'relative',
            overflow: 'hidden',
            py: 3.5,
            borderRadius: 4,
            textAlign: 'center',
            bgcolor: cores.superficieAlta,
            border: '1px solid',
            borderColor: alpha(cores.vermelho, 0.28),
            '&::before': {
              content: '""',
              position: 'absolute',
              inset: 0,
              background: `radial-gradient(70% 100% at 50% 0%, ${alpha(cores.vermelho, 0.18)} 0%, transparent 70%)`,
            },
            '& > *': { position: 'relative' },
          }}
        >
          <Typography variant="overline" color="text.secondary">
            seu código
          </Typography>
          <Typography
            sx={{
              // Monoespaçada e com espaço entre as letras: este código vai ser
              // lido em voz alta e digitado à mão. O que importa aqui é não
              // confundir zero com O, não a elegância da fonte.
              fontFamily: 'ui-monospace, "SFMono-Regular", Menlo, Consolas, monospace',
              fontSize: 46,
              fontWeight: 800,
              letterSpacing: '0.14em',
              // Indentação à direita compensando o `letter-spacing`, que
              // adiciona o espaço DEPOIS do último caractere e desalinharia o
              // código do centro da caixa.
              textIndent: '0.14em',
              lineHeight: 1.15,
              background: cores.gradiente,
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
            }}
          >
            {estado.userCode}
          </Typography>
        </Box>

        <Button
          fullWidth
          size="large"
          variant="contained"
          disabled={!estado.verificationUrl}
          onClick={() => {
            if (estado.verificationUrl) void ponte.abrirNoNavegador(estado.verificationUrl);
          }}
        >
          Autorizar no navegador
        </Button>

        <Stack direction="row" spacing={1} alignItems="center" justifyContent="center">
          {/* Um ponto pulsando no lugar do selo "aguardando": a espera aqui é
              contínua, e uma etiqueta parada não passa isso. */}
          <Box
            sx={{
              width: 7,
              height: 7,
              borderRadius: '50%',
              bgcolor: cores.atencao,
              animation: 'espera 1.6s ease-in-out infinite',
              '@keyframes espera': { '0%, 100%': { opacity: 1 }, '50%': { opacity: 0.25 } },
            }}
          />
          <Typography variant="caption" color="text.secondary">
            Assim que você aprovar lá, esta tela passa sozinha.
          </Typography>
        </Stack>
      </Stack>
    </Moldura>
  );
}

/**
 * Um passo do onboarding, numerado.
 *
 * A numeração é o conteúdo, não enfeite: o problema desta tela nunca foi a
 * falta de explicação, foi a falta de ORDEM. Dois logins apareciam juntos e nada
 * dizia qual vinha antes. O passo inativo continua visível, e apagado, porque
 * saber o que vem depois é o que impede a pessoa de achar que o app travou.
 */
function Passo({
  numero,
  titulo,
  ativo = false,
  children,
}: {
  readonly numero: number;
  readonly titulo: string;
  readonly ativo?: boolean;
  readonly children: React.ReactNode;
}): JSX.Element {
  return (
    <Stack
      direction="row"
      spacing={1.5}
      sx={{
        p: 2,
        borderRadius: 3,
        opacity: ativo ? 1 : 0.55,
        bgcolor: ativo ? cores.superficieAlta : 'transparent',
        border: '1px solid',
        borderColor: ativo ? alpha(cores.vermelho, 0.28) : cores.borda,
      }}
    >
      <Box
        sx={{
          flexShrink: 0,
          width: 26,
          height: 26,
          borderRadius: '50%',
          display: 'grid',
          placeItems: 'center',
          fontSize: 13,
          fontWeight: 800,
          color: ativo ? '#fff' : 'text.secondary',
          background: ativo ? cores.gradiente : alpha('#ffffff', 0.06),
        }}
      >
        {numero}
      </Box>
      <Stack spacing={0.5} sx={{ minWidth: 0 }}>
        <Typography variant="subtitle2" fontWeight={800}>
          {titulo}
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ lineHeight: 1.55 }}>
          {children}
        </Typography>
      </Stack>
    </Stack>
  );
}

function Moldura({ children }: { readonly children: React.ReactNode }): JSX.Element {
  return (
    <Stack spacing={2.5} sx={{ p: 3, pt: 2, overflowY: 'auto' }}>
      {/*
        A primeira tela do app é a única que ninguém pediu para ver: o vendedor
        baixou um instalador e agora um programa quer que ele digite um código
        num site. O logo grande aqui é o que amarra esta janela ao produto que
        ele já usa no navegador — sem ele, esta tela poderia ser de qualquer um.
      */}
      <Stack spacing={1.5} alignItems="flex-start">
        <Logo tamanho={52} />
        <Typography variant="h5">Ativar este computador</Typography>
      </Stack>
      {children}
    </Stack>
  );
}
