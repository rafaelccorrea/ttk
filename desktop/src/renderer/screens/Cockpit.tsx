import SettingsIcon from '@mui/icons-material/SettingsOutlined';
import { Box, Button, Chip, IconButton, Stack, Tooltip, Typography, alpha } from '@mui/material';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  AvisoDoTikTok,
  EstadoConexao,
  EstadoEnvio,
  ProdutoDaLive,
} from '@shared/desktop-api';
import type { LiveReplyEvent } from '@shared/live-events';
import { BarraDeStatus } from '../components/BarraDeStatus';
import { CardEscalacao } from '../components/CardEscalacao';
import { CardResposta } from '../components/CardResposta';
import { DialogoTermoDeEnvio } from '../components/DialogoTermoDeEnvio';
import { FeedDeEnvios, type ItemDeEnvio } from '../components/FeedDeEnvios';
import { Aviso } from '../components/Estados';
import { useFluxoDaLive } from '../hooks/useFluxoDaLive';
import { cores } from '../theme/theme';
import { LINKS } from '../links';
import { SEM_PONTE, obterPonte } from '../ponte';

/**
 * Tela 3 — o cockpit, ao lado da BrowserView do TikTok.
 *
 * A hierarquia da tela é a hierarquia da urgência, de cima para baixo:
 *
 *   1. o que exige o vendedor AGORA (escalações);
 *   2. o que ele pode usar sem pensar (respostas prontas);
 *   3. o que ele só confere de relance (a barra de status).
 *
 * A rolagem fica DENTRO de cada bloco, não na tela. Uma página que rola inteira
 * faria a escalação nova nascer fora da vista sempre que o vendedor tivesse
 * descido para ler uma resposta — exatamente no momento em que ele mais precisa
 * vê-la.
 */
/**
 * O que a barra mostra antes de o processo principal responder.
 *
 * `painel` como chute inicial, sempre: se a leitura falhar ou demorar, a tela
 * erra dizendo que NÃO está enviando. O erro na direção contrária faria o
 * vendedor acreditar, por um instante, que o app está postando por ele.
 */
const ENVIO_DESCONHECIDO: EstadoEnvio = {
  modo: 'painel',
  aceito: false,
  pausado: false,
  cadenciaSegundos: 8,
  maxPorMinuto: 6,
  degradacao: null,
};

export function Cockpit({
  aoAbrirConfiguracoes,
  aoEncerrar,
}: {
  readonly aoAbrirConfiguracoes: () => void;
  readonly aoEncerrar: () => void;
}): JSX.Element {
  const ponte = obterPonte();
  const fluxo = useFluxoDaLive();
  const [conexao, setConexao] = useState<EstadoConexao | null>(null);
  const [pausado, setPausado] = useState(false);
  /**
   * O saldo lido uma vez, na entrada. Os minutos restantes na barra são ele
   * menos o que a run já cobrou — que é o que o `stats` traz. Ler a carteira a
   * cada minuto seria uma requisição por batimento para exibir um número que já
   * chega pelo fluxo.
   */
  const [saldoInicial, setSaldoInicial] = useState<number | null>(null);

  const [envio, setEnvio] = useState<EstadoEnvio>(ENVIO_DESCONHECIDO);
  const [termoAberto, setTermoAberto] = useState(false);
  /**
   * Acende quando entra escalação NOVA e apaga sozinho: é o flash que puxa o
   * canto do olho de quem está falando com a câmera — junto com o chime.
   */
  const [flashEscalacao, setFlashEscalacao] = useState(false);
  const escalacoesAntes = useRef(0);
  /** Por que a última tentativa de ligar o automático não pegou. */
  const [erroDoModo, setErroDoModo] = useState<string | null>(null);
  /** O banner de aviso do TikTok — o main já pausou (ou encerrou) quando chega. */
  const [avisoTikTok, setAvisoTikTok] = useState<AvisoDoTikTok | null>(null);
  const [produtos, setProdutos] = useState<ProdutoDaLive[]>([]);
  const [fixando, setFixando] = useState<string | null>(null);
  const [pinAviso, setPinAviso] = useState<{ ok: boolean; texto: string } | null>(
    null,
  );

  useEffect(() => {
    if (!ponte) return undefined;
    return ponte.aoAvisoDoTikTok(setAvisoTikTok);
  }, [ponte]);

  // A lista de produtos vem da base conectada, uma vez por entrada na tela —
  // o catálogo não muda no meio da live.
  useEffect(() => {
    if (!ponte) return;
    void ponte
      .listarProdutosDaLive()
      .then(setProdutos)
      .catch(() => setProdutos([]));
  }, [ponte]);

  const fixar = async (titulo: string): Promise<void> => {
    if (!ponte) return;
    setFixando(titulo);
    setPinAviso(null);
    try {
      const resultado = await ponte.fixarProduto(titulo);
      setPinAviso(
        resultado.ok
          ? { ok: true, texto: `"${titulo}" fixado na live.` }
          : {
              ok: false,
              texto: resultado.motivo ?? 'Não consegui fixar — tente manualmente.',
            },
      );
    } catch {
      setPinAviso({ ok: false, texto: 'Não consegui fixar — tente manualmente.' });
    } finally {
      setFixando(null);
    }
  };

  useEffect(() => {
    if (!ponte) return undefined;
    void ponte.obterConexao().then(setConexao).catch(() => undefined);
    void ponte
      .obterCarteiraLive()
      .then((c) => setSaldoInicial(c.minutos))
      .catch(() => undefined);
    return ponte.aoMudarConexao(setConexao);
  }, [ponte]);

  useEffect(() => {
    if (!ponte) return undefined;
    void ponte.obterEstadoEnvio().then(setEnvio).catch(() => undefined);
    // A assinatura é o que faz o Ctrl+Shift+P aparecer na tela: a pausa é
    // decidida no processo principal, com a janela do TikTok na frente, e a
    // barra só descobre por aqui.
    return ponte.aoMudarEnvio(setEnvio);
  }, [ponte]);

  /**
   * Liga o automático de verdade — depois do aceite, e só se o backend deixar.
   *
   * A recusa do servidor (sem aceite, kill switch, plano) vira texto na tela em
   * vez de um switch que volta sozinho sem explicação.
   */
  const ligarAutomatico = useCallback(async (): Promise<void> => {
    if (!ponte) return;
    setErroDoModo(null);
    try {
      setEnvio(await ponte.definirModoDeEnvio('auto'));
    } catch (e) {
      setErroDoModo((e as Error).message);
    }
  }, [ponte]);

  const alternarModo = useCallback(async (): Promise<void> => {
    if (!ponte) return;
    if (envio.modo === 'auto') {
      setErroDoModo(null);
      try {
        setEnvio(await ponte.definirModoDeEnvio('painel'));
      } catch (e) {
        setErroDoModo((e as Error).message);
      }
      return;
    }
    // Sem aceite registrado, o caminho passa PELO AVISO — e não por um switch
    // que liga e depois falha com o 403 do servidor.
    if (!envio.aceito) {
      setTermoAberto(true);
      return;
    }
    await ligarAutomatico();
  }, [ponte, envio.modo, envio.aceito, ligarAutomatico]);

  const alternarPausaDoEnvio = useCallback((): void => {
    if (!ponte) return;
    void ponte.pausarEnvio(!envio.pausado).then(setEnvio).catch(() => undefined);
  }, [ponte, envio.pausado]);

  const alternarPausa = useCallback(async (): Promise<void> => {
    if (!ponte) return;
    const proximo = !pausado;
    setPausado(proximo);
    try {
      await ponte.pausar(proximo);
    } catch {
      // O processo principal é quem de fato para de mandar lote; se ele
      // recusou, o botão volta ao que era em vez de mentir sobre o estado.
      setPausado(!proximo);
    }
  }, [ponte, pausado]);

  /*
   * O único som do app, e por bom motivo: a escalação é o único evento que
   * EXIGE o vendedor — todo o resto o copiloto resolve sozinho. Quem está
   * olhando para a câmera não vê card nenhum nascer; o chime é o que o traz
   * de volta ao painel. Duas notas curtas via WebAudio (nenhum asset), volume
   * baixo o bastante para não vazar no microfone da live.
   */
  useEffect(() => {
    const agora = fluxo.escalacoes.length;
    if (agora > escalacoesAntes.current) {
      tocarChime();
      setFlashEscalacao(true);
      const id = window.setTimeout(() => setFlashEscalacao(false), 1_600);
      escalacoesAntes.current = agora;
      return () => window.clearTimeout(id);
    }
    escalacoesAntes.current = agora;
    return undefined;
  }, [fluxo.escalacoes.length]);

  /**
   * As respostas de baixa confiança viram o RASCUNHO da escalação, casadas
   * pela mensagem que as originou. É o mesmo modelo, a mesma chamada e o mesmo
   * custo já pago — jogar esse texto fora só porque a nota ficou abaixo do
   * corte deixaria o vendedor digitando do zero um texto que já existe.
   */
  const rascunhos = useMemo(() => {
    const mapa = new Map<string, LiveReplyEvent>();
    for (const r of fluxo.respostas) {
      if (r.decision === 'escalar' && !mapa.has(r.chatMessageId)) {
        mapa.set(r.chatMessageId, r);
      }
    }
    return mapa;
  }, [fluxo.respostas]);

  const prontas = useMemo(
    () => fluxo.respostas.filter((r) => r.decision === 'enviar'),
    [fluxo.respostas],
  );

  /**
   * O feed do automático: as mesmas respostas aprovadas, vistas pelo lado da
   * ENTREGA. Sem confirmação do backend a resposta conta como pendente — o
   * inverso (assumir entregue até provar o contrário) é a mentira que faria o
   * vendedor achar que uma pergunta foi respondida quando não foi.
   */
  const envios = useMemo<ItemDeEnvio[]>(
    () =>
      prontas.map((r) => {
        const entrega = fluxo.entregas[r.id];
        return {
          replyId: r.id,
          texto: r.text,
          pergunta: fluxo.perguntas[r.chatMessageId] ?? null,
          confianca: r.confidence,
          status: entrega?.deliveryStatus ?? 'pendente',
          motivo: entrega?.failureReason ?? null,
        };
      }),
    [prontas, fluxo.entregas, fluxo.perguntas],
  );

  if (!ponte) {
    return (
      <Box sx={{ p: 3 }}>
        <Aviso tom="erro" titulo="O copiloto não subiu" descricao={SEM_PONTE} />
      </Box>
    );
  }

  const minutosRestantes =
    saldoInicial === null
      ? null
      : Math.max(0, saldoInicial - (fluxo.stats?.minutesCharged ?? 0));

  const estadoBarra: EstadoConexao = conexao ?? {
    status: 'conectando',
    runId: null,
    tiktokUsername: null,
    baseTitulo: null,
    motivo: null,
    simulada: false,
  };

  return (
    <Stack sx={{ height: '100%', minHeight: 0 }}>
      <Stack
        direction="row"
        alignItems="center"
        spacing={1}
        sx={{
          px: 2.25,
          py: 1.25,
          borderBottom: '1px solid',
          borderColor: 'divider',
          flexShrink: 0,
        }}
      >
        <Stack sx={{ minWidth: 0 }}>
          <Stack direction="row" alignItems="center" spacing={0.85} sx={{ minWidth: 0 }}>
            <Typography variant="subtitle1" fontWeight={800} noWrap>
              {estadoBarra.tiktokUsername ?? 'Sua live'}
            </Typography>
            {/* O rótulo que impede o susto na fatura: nada aqui foi ao TikTok. */}
            {estadoBarra.simulada ? (
              <Chip
                size="small"
                label="live de teste"
                sx={{
                  height: 18,
                  fontSize: 10.5,
                  bgcolor: alpha(cores.ciano, 0.14),
                  color: cores.ciano,
                  border: '1px solid',
                  borderColor: alpha(cores.ciano, 0.4),
                }}
              />
            ) : null}
          </Stack>
          {/*
            A base entra com um ponto ciano na frente: sem ele esta linha é só
            mais um cinza pequeno, e ela responde a "de onde vêm as respostas
            que eu estou lendo?" — que é a primeira dúvida quando uma delas sai
            errada.
          */}
          <Stack direction="row" alignItems="center" spacing={0.65} sx={{ minWidth: 0 }}>
            <Box
              sx={{
                width: 5,
                height: 5,
                borderRadius: '50%',
                bgcolor: cores.ciano,
                flexShrink: 0,
              }}
            />
            <Typography variant="caption" color="text.secondary" noWrap>
              {estadoBarra.baseTitulo ?? 'base de conhecimento'}
            </Typography>
          </Stack>
        </Stack>
        <Box sx={{ flex: 1 }} />
        <Tooltip title="Ajustes">
          <IconButton size="small" onClick={aoAbrirConfiguracoes} aria-label="Ajustes">
            <SettingsIcon fontSize="small" />
          </IconButton>
        </Tooltip>
      </Stack>

      {/*
        O aviso de saldo entra COMO FAIXA e não como diálogo: derrubar a tela
        num modal apagaria as respostas que ainda estão valendo e que o vendedor
        pode usar enquanto compra mais horas no celular.
      */}
      {fluxo.semSaldo ? (
        <Box sx={{ px: 2, pb: 1 }}>
          <Aviso
            tom="erro"
            titulo="Suas horas de live acabaram"
            descricao={`${fluxo.semSaldo} O copiloto parou de ler o chat, mas o que já está aqui continua na tela. Compre um pacote de horas para voltar ainda nesta live.`}
            acao={{
              rotulo: 'Comprar horas',
              aoClicar: () => void ponte.abrirNoNavegador(LINKS.planos),
            }}
          />
        </Box>
      ) : null}

      {/*
        O aviso do TikTok é a faixa mais séria da tela: é a conta do vendedor
        em jogo. Quando ela aparece, o main já agiu (pausou o envio, ou
        encerrou a live no opt-in) — aqui é contar o que aconteceu e apontar o
        próximo passo.
      */}
      {avisoTikTok ? (
        <Box sx={{ px: 2, pb: 1 }}>
          <Aviso
            tom="erro"
            titulo={
              avisoTikTok.acao === 'encerrado'
                ? 'O TikTok emitiu um aviso — a transmissão foi encerrada'
                : 'O TikTok emitiu um aviso — envio pausado'
            }
            descricao={`${avisoTikTok.texto ? `"${avisoTikTok.texto}" — ` : ''}${
              avisoTikTok.acao === 'encerrado'
                ? 'Você ligou o encerramento automático nas configurações. Revise o aviso na sua conta antes de abrir outra live.'
                : 'Por segurança, o copiloto parou de enviar no chat. Revise o aviso na sua tela do TikTok; as respostas continuam aqui para você copiar.'
            }`}
          />
        </Box>
      ) : null}

      {/*
        A DEGRADAÇÃO VEM ANTES DE TUDO.

        Quando o app cai sozinho para somente-painel, o vendedor precisa
        descobrir na mesma olhada em que descobriria qualquer outra coisa — e
        precisa saber o que fazer agora, que é copiar na mão. O pior estado
        possível deste produto é ele seguir vendendo achando que o copiloto está
        respondendo o chat sozinho enquanto o chat está mudo.
      */}
      {envio.degradacao ? (
        <Box sx={{ px: 2, pb: 1 }}>
          <Aviso
            tom="erro"
            titulo="O envio automático parou"
            descricao={`${envio.degradacao} As respostas continuam aparecendo aqui: toque em Copiar e cole no chat da sua live.`}
          />
        </Box>
      ) : null}

      {erroDoModo ? (
        <Box sx={{ px: 2, pb: 1 }}>
          <Aviso
            tom="erro"
            titulo="Não deu para ligar o envio automático"
            descricao={erroDoModo}
          />
        </Box>
      ) : null}

      {/*
        O RESUMO fecha o ciclo: a live acabou e esta é a única chance de o
        vendedor ver, em números, o que o copiloto fez por ele — depois disso a
        história só existe no site. Os números vêm do evento `ended`, que
        carrega os contadores finais da run.
      */}
      {fluxo.encerrada && !fluxo.semSaldo ? (
        <Box sx={{ px: 2, pb: 1 }}>
          <ResumoDaLive
            motivo={fluxo.encerrada}
            stats={fluxo.stats}
            picoViewers={fluxo.picoViewers}
            curtidas={fluxo.curtidas}
            aoFechar={aoEncerrar}
          />
        </Box>
      ) : null}

      {/* ------------------------------------------------ painel de escalação */}
      <Box
        sx={{
          px: 2.25,
          pb: 1,
          pt: 1,
          flex: '0 1 auto',
          minHeight: 0,
          overflowY: 'auto',
          // O flash da escalação nova: um lavado vermelho que acende e escorre
          // de volta ao nada — pareado com o chime, para o canto do olho.
          transition: 'background-color 1.2s ease',
          bgcolor: flashEscalacao ? alpha(cores.vermelho, 0.14) : 'transparent',
        }}
      >
        <TituloDeSecao
          texto="precisa de você"
          cor={cores.vermelho}
          contagem={fluxo.escalacoes.length}
        />
        {fluxo.escalacoes.length === 0 ? (
          <Typography variant="body2" color="text.secondary" sx={{ py: 1, lineHeight: 1.55 }}>
            Nada travado por aqui. Quando alguém perguntar algo que eu não souber
            responder com segurança, aparece nesta faixa.
          </Typography>
        ) : (
          <Stack spacing={1.25} sx={{ mt: 0.5 }}>
            {fluxo.escalacoes.map((e) => {
              const rascunho = rascunhos.get(e.chatMessageId) ?? null;
              return (
                <CardEscalacao
                  key={e.chatMessageId}
                  escalacao={e}
                  rascunho={rascunho?.text ?? null}
                  replyId={rascunho?.id ?? null}
                  aoSalvarNaBase={(replyId, texto) =>
                    ponte.salvarNaBase(replyId, texto)
                  }
                  aoCopiar={(texto) => {
                    if (rascunho) void ponte.copiarResposta(rascunho.id, texto);
                    else void ponte.copiarTexto(texto);
                  }}
                  aoResponder={() => {
                    fluxo.descartarEscalacao(e.chatMessageId);
                    void ponte.resolverEscalacao(e.chatMessageId, 'respondida');
                  }}
                  aoDescartar={() => {
                    fluxo.descartarEscalacao(e.chatMessageId);
                    void ponte.resolverEscalacao(e.chatMessageId, 'descartada');
                  }}
                />
              );
            })}
          </Stack>
        )}
      </Box>

      {/* --------------------------------------------------- fixar produto */}
      {produtos.length > 0 ? (
        <Box
          sx={{
            px: 2.25,
            py: 1,
            borderTop: '1px solid',
            borderColor: 'divider',
          }}
        >
          <TituloDeSecao
            texto="fixar produto na live"
            cor={cores.ciano}
            contagem={produtos.length}
          />
          {/*
            Best-effort declarado: o clique tenta fixar no painel do TikTok
            Shop, e a falha vem com instrução de fixar à mão — nunca trava o
            resto do cockpit.
          */}
          <Stack
            direction="row"
            flexWrap="wrap"
            useFlexGap
            spacing={0.75}
            sx={{ mt: 0.5 }}
          >
            {produtos.map((p) => (
              <Chip
                key={p.id}
                label={fixando === p.title ? `Fixando ${p.title}…` : p.title}
                size="small"
                disabled={fixando !== null}
                onClick={() => void fixar(p.title)}
              />
            ))}
          </Stack>
          {pinAviso ? (
            <Typography
              variant="caption"
              sx={{ color: pinAviso.ok ? cores.sucesso : cores.vermelho }}
            >
              {pinAviso.texto}
            </Typography>
          ) : null}
        </Box>
      ) : null}

      {/* ------------------------------------------------- respostas prontas */}
      <Box
        sx={{
          px: 2.25,
          py: 1,
          flex: '1 1 auto',
          minHeight: 0,
          overflowY: 'auto',
          borderTop: '1px solid',
          borderColor: 'divider',
        }}
      >
        <TituloDeSecao
          texto={envio.modo === 'auto' ? 'enviadas no chat' : 'prontas para copiar'}
          cor={envio.modo === 'auto' ? cores.sucesso : cores.ciano}
          contagem={envio.modo === 'auto' ? envios.length : prontas.length}
        />
        {/*
          No automático a mesma lista troca de eixo: deixa de ser "o que você
          pode copiar" e passa a ser "o que saiu em seu nome". Duas listas
          paralelas com o mesmo conteúdo obrigariam o vendedor a cruzar as duas
          para saber se uma resposta foi ou não ao chat.
        */}
        {envio.modo === 'auto' ? (
          <FeedDeEnvios itens={envios} />
        ) : prontas.length === 0 ? (
          <Typography variant="body2" color="text.secondary" sx={{ py: 1, lineHeight: 1.55 }}>
            {estadoBarra.status === 'ativa'
              ? 'Estou lendo o chat. A primeira pergunta sobre preço, tamanho ou frete já vira resposta aqui.'
              : 'Assim que a live estiver no ar, as respostas aparecem aqui para você copiar.'}
          </Typography>
        ) : (
          <Stack spacing={1} sx={{ mt: 0.5 }}>
            {prontas.map((r) => (
              <CardResposta
                key={r.id}
                resposta={r}
                aoCopiar={() => ponte.copiarResposta(r.id, r.text)}
              />
            ))}
          </Stack>
        )}
      </Box>

      <BarraDeStatus
        conexao={fluxo.semSaldo ? { ...estadoBarra, status: 'sem_saldo' } : estadoBarra}
        envio={envio}
        minutosRestantes={minutosRestantes}
        respostasPorMinuto={fluxo.respostasPorMinuto}
        viewers={fluxo.viewers}
        curtidas={fluxo.curtidas}
        pausado={pausado}
        aoAlternarPausa={() => void alternarPausa()}
        aoAlternarModo={() => void alternarModo()}
        aoAlternarPausaDoEnvio={alternarPausaDoEnvio}
        aoEncerrar={() => {
          void ponte.encerrar('Encerrado pelo vendedor no painel.');
          aoEncerrar();
        }}
      />

      <DialogoTermoDeEnvio
        aberto={termoAberto}
        aoAceitar={() => {
          setTermoAberto(false);
          void ligarAutomatico();
        }}
        // Recusar fecha e não muda mais nada: o app segue inteiro no painel.
        aoRecusar={() => setTermoAberto(false)}
      />
    </Stack>
  );
}

/**
 * Duas notas curtas (Lá5 → Dó6), geradas na hora — nenhum arquivo de som no
 * bundle. O volume é deliberadamente baixo: precisa alcançar o vendedor a um
 * metro da tela sem vazar no microfone da transmissão.
 */
function tocarChime(): void {
  try {
    const ctx = new AudioContext();
    const tocar = (freq: number, inicio: number): void => {
      const osc = ctx.createOscillator();
      const ganho = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      ganho.gain.setValueAtTime(0.0001, ctx.currentTime + inicio);
      ganho.gain.exponentialRampToValueAtTime(0.06, ctx.currentTime + inicio + 0.02);
      ganho.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + inicio + 0.28);
      osc.connect(ganho).connect(ctx.destination);
      osc.start(ctx.currentTime + inicio);
      osc.stop(ctx.currentTime + inicio + 0.3);
    };
    tocar(880, 0);
    tocar(1046.5, 0.14);
    window.setTimeout(() => void ctx.close(), 700);
  } catch {
    // Sem áudio (driver, política do SO) o flash visual continua fazendo o papel.
  }
}

/**
 * O placar de fim de live. O motivo vem primeiro (é a resposta a "por que
 * parou?"); os números vêm grandes porque são o argumento de valor do produto
 * — e o botão devolve o vendedor ao começo do fluxo.
 */
function ResumoDaLive({
  motivo,
  stats,
  picoViewers,
  curtidas,
  aoFechar,
}: {
  readonly motivo: string;
  readonly stats: import('@shared/live-events').LiveStatsEvent | null;
  readonly picoViewers: number;
  readonly curtidas: number;
  readonly aoFechar: () => void;
}): JSX.Element {
  const numeros: Array<{ valor: string; rotulo: string }> = [];
  if (stats) {
    numeros.push(
      { valor: `${stats.minutesCharged}`, rotulo: 'min de live' },
      { valor: `${stats.repliesSent}`, rotulo: 'enviadas no chat' },
      { valor: `${stats.repliesGenerated}`, rotulo: 'respostas geradas' },
      { valor: `${stats.escalations}`, rotulo: 'escaladas p/ você' },
    );
  }
  if (picoViewers > 0) numeros.push({ valor: `${picoViewers}`, rotulo: 'pico de público' });
  if (curtidas > 0) numeros.push({ valor: `${curtidas}`, rotulo: 'curtidas' });

  return (
    <Box
      sx={{
        p: 2,
        borderRadius: 3.5,
        bgcolor: cores.superficieAlta,
        border: '1px solid',
        borderColor: alpha(cores.ciano, 0.35),
      }}
    >
      <Typography fontWeight={800} sx={{ mb: 0.35 }}>
        A transmissão foi encerrada
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: numeros.length ? 1.5 : 1 }}>
        {motivo}
      </Typography>
      {numeros.length ? (
        <Stack direction="row" flexWrap="wrap" useFlexGap spacing={2.5} sx={{ mb: 1.5 }}>
          {numeros.map((n) => (
            <Stack key={n.rotulo} spacing={0}>
              <Typography variant="h6" fontWeight={800} sx={{ lineHeight: 1.15 }}>
                {n.valor}
              </Typography>
              <Typography variant="caption" color="text.secondary">
                {n.rotulo}
              </Typography>
            </Stack>
          ))}
        </Stack>
      ) : null}
      <Button size="small" variant="contained" onClick={aoFechar}>
        Conectar outra live
      </Button>
    </Box>
  );
}

/**
 * O rótulo de um dos dois blocos do cockpit.
 *
 * A contagem vive AQUI, e não dentro da lista, porque a tela rola por dentro
 * de cada bloco: com quatro escalações e o bloco mostrando duas, o vendedor não
 * tem como saber que há mais embaixo. O número no título é o que diz.
 *
 * Ele some quando é zero — um "0" ao lado de "precisa de você" é uma etiqueta
 * chamando atenção para a ausência de trabalho.
 */
function TituloDeSecao({
  texto,
  cor,
  contagem,
}: {
  readonly texto: string;
  readonly cor: string;
  readonly contagem: number;
}): JSX.Element {
  return (
    <Stack direction="row" alignItems="center" spacing={0.85} sx={{ mb: 0.25 }}>
      <Box sx={{ width: 3, height: 11, borderRadius: 999, bgcolor: cor, flexShrink: 0 }} />
      <Typography variant="overline" sx={{ color: cor }}>
        {texto}
      </Typography>
      {contagem > 0 ? (
        <Typography
          variant="caption"
          sx={{
            px: 0.75,
            borderRadius: 999,
            fontWeight: 750,
            fontSize: 10.5,
            color: cor,
            bgcolor: alpha(cor, 0.14),
            fontVariantNumeric: 'tabular-nums',
          }}
        >
          {contagem}
        </Typography>
      ) : null}
    </Stack>
  );
}
