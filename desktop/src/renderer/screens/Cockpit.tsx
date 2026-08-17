import SettingsIcon from '@mui/icons-material/SettingsOutlined';
import { Box, Divider, IconButton, Stack, Typography } from '@mui/material';
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { EstadoConexao } from '@shared/desktop-api';
import type { LiveReplyEvent } from '@shared/live-events';
import { BarraDeStatus } from '../components/BarraDeStatus';
import { CardEscalacao } from '../components/CardEscalacao';
import { CardResposta } from '../components/CardResposta';
import { Aviso } from '../components/Estados';
import { useFluxoDaLive } from '../hooks/useFluxoDaLive';
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

  useEffect(() => {
    if (!ponte) return undefined;
    void ponte.obterConexao().then(setConexao).catch(() => undefined);
    void ponte
      .obterCarteiraLive()
      .then((c) => setSaldoInicial(c.minutos))
      .catch(() => undefined);
    return ponte.aoMudarConexao(setConexao);
  }, [ponte]);

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
  };

  return (
    <Stack sx={{ height: '100%', minHeight: 0 }}>
      <Stack
        direction="row"
        alignItems="center"
        spacing={1}
        sx={{ px: 2, pt: 1.5, pb: 1 }}
      >
        <Stack sx={{ minWidth: 0 }}>
          <Typography variant="subtitle1" fontWeight={800} noWrap>
            {estadoBarra.tiktokUsername ?? 'Sua live'}
          </Typography>
          <Typography variant="caption" color="text.secondary" noWrap>
            {estadoBarra.baseTitulo ?? 'base de conhecimento'}
          </Typography>
        </Stack>
        <Box sx={{ flex: 1 }} />
        <IconButton size="small" onClick={aoAbrirConfiguracoes} aria-label="Ajustes">
          <SettingsIcon fontSize="small" />
        </IconButton>
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
              aoClicar: () => void ponte.abrirNoNavegador('https://app.pikpok.com.br/planos'),
            }}
          />
        </Box>
      ) : null}

      {fluxo.encerrada && !fluxo.semSaldo ? (
        <Box sx={{ px: 2, pb: 1 }}>
          <Aviso
            titulo="A transmissão foi encerrada"
            descricao={fluxo.encerrada}
            acao={{ rotulo: 'Conectar de novo', aoClicar: aoEncerrar }}
          />
        </Box>
      ) : null}

      {/* ------------------------------------------------ painel de escalação */}
      <Box sx={{ px: 2, pb: 1, flex: '0 1 auto', minHeight: 0, overflowY: 'auto' }}>
        <Typography variant="overline" color="primary.main">
          precisa de você
        </Typography>
        {fluxo.escalacoes.length === 0 ? (
          <Typography variant="body2" color="text.secondary" sx={{ py: 1 }}>
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

      <Divider />

      {/* ------------------------------------------------- respostas prontas */}
      <Box sx={{ px: 2, py: 1, flex: '1 1 auto', minHeight: 0, overflowY: 'auto' }}>
        <Typography variant="overline" color="text.secondary">
          prontas para copiar
        </Typography>
        {prontas.length === 0 ? (
          <Typography variant="body2" color="text.secondary" sx={{ py: 1 }}>
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
        minutosRestantes={minutosRestantes}
        respostasPorMinuto={fluxo.respostasPorMinuto}
        pausado={pausado}
        aoAlternarPausa={() => void alternarPausa()}
        aoEncerrar={() => {
          void ponte.encerrar('Encerrado pelo vendedor no painel.');
          aoEncerrar();
        }}
      />
    </Stack>
  );
}
