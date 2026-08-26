import {
  Box,
  Button,
  Chip,
  Divider,
  Slider,
  Stack,
  Switch,
  TextField,
  Tooltip,
  Typography,
  alpha,
} from '@mui/material';
import { useCallback, useEffect, useState } from 'react';
import type { ConfiguracoesCopiloto } from '@shared/desktop-api';
import { LOTE_MAXIMO, LOTE_MINIMO } from '@shared/desktop-api';
import { BlocoDaConta } from '../components/BlocoDaConta';
import { Aviso, Carregando } from '../components/Estados';
import { mensagemDeErro } from '../erros';
import { cores } from '../theme/theme';
import { SEM_PONTE, obterPonte } from '../ponte';
import { useEstadoAtualizacao } from '../hooks/useEstadoAtualizacao';

/**
 * Tela 4 — ajustes do copiloto.
 *
 * Três controles, e cada um resolve uma reclamação concreta que aparece na
 * primeira live: "ele fala demais", "ele responde besteira do chat" e "ele
 * demora". Nada aqui é ajuste fino de modelo — o vendedor não conhece nem
 * precisa conhecer os nomes de dentro.
 *
 * Os valores ficam no computador dele e valem no lote seguinte. Não há botão de
 * "restaurar padrão de fábrica" porque os padrões já são os que a gente
 * recomenda e cada slider mostra onde eles estão.
 *
 * POR QUE A TELA É DENSA
 * ----------------------
 * A versão anterior dava um cartão inteiro a cada controle — padding largo,
 * parágrafo de explicação, slider sozinho na linha. Com nove controles isso
 * virava 1.800 px de rolagem numa coluna de 700 px, e o botão de salvar ficava
 * lá embaixo, fora da vista. Agora cada controle é UMA linha dentro de uma
 * seção (Respostas, Chat, Vitrine, Proteção, Sistema), a explicação cabe numa
 * linha de legenda (o detalhe fica no tooltip do título) e o salvar mora num
 * rodapé fixo. A tela inteira cabe em ~1000 px sem perder nenhum ajuste.
 */
export function Configuracoes({
  aoVoltar,
  aoSair,
}: {
  readonly aoVoltar: () => void;
  /** Chamado depois de o token ser esquecido: o shell volta para a ativação. */
  readonly aoSair: () => void;
}): JSX.Element {
  const ponte = obterPonte();
  const [valores, setValores] = useState<ConfiguracoesCopiloto | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);
  const [salvo, setSalvo] = useState(false);
  const [listaNegraTexto, setListaNegraTexto] = useState('');
  const [bloqueadosTexto, setBloqueadosTexto] = useState('');

  const carregar = useCallback(async (): Promise<void> => {
    if (!ponte) return;
    setErro(null);
    try {
      const lidos = await ponte.lerConfiguracoes();
      setValores(lidos);
      setListaNegraTexto(lidos.listaNegra.join(', '));
      setBloqueadosTexto(lidos.usuariosBloqueados.join(', '));
    } catch (e) {
      setErro(mensagemDeErro(e));
    }
  }, [ponte]);

  useEffect(() => {
    void carregar();
  }, [carregar]);


  if (!ponte) {
    return (
      <Moldura aoVoltar={aoVoltar}>
        <Aviso tom="erro" titulo="Não consegui abrir os ajustes" descricao={SEM_PONTE} />
      </Moldura>
    );
  }

  if (erro) {
    return (
      <Moldura aoVoltar={aoVoltar}>
        <Aviso
          tom="erro"
          titulo="Não consegui ler os seus ajustes"
          descricao={erro}
          acao={{ rotulo: 'Tentar de novo', aoClicar: () => void carregar() }}
        />
      </Moldura>
    );
  }

  if (!valores) {
    return (
      <Moldura aoVoltar={aoVoltar}>
        <Carregando texto="Abrindo os seus ajustes…" />
      </Moldura>
    );
  }

  const alterar = (parcial: Partial<ConfiguracoesCopiloto>): void => {
    setValores({ ...valores, ...parcial });
    setSalvo(false);
  };

  const salvar = async (): Promise<void> => {
    setSalvando(true);
    setErro(null);
    try {
      const gravados = await ponte.salvarConfiguracoes({
        ...valores,
        listaNegra: separarPalavras(listaNegraTexto),
        usuariosBloqueados: separarPalavras(bloqueadosTexto),
      });
      setValores(gravados);
      setListaNegraTexto(gravados.listaNegra.join(', '));
      setBloqueadosTexto(gravados.usuariosBloqueados.join(', '));
      setSalvo(true);
    } catch (e) {
      setErro(mensagemDeErro(e));
    } finally {
      setSalvando(false);
    }
  };

  /* O rodapé é passado à Moldura para ficar fora da área que rola. */
  const rodape = (
    <Stack direction="row" spacing={1.25} alignItems="center">
      <Button variant="contained" onClick={() => void salvar()} disabled={salvando}>
        {salvando ? 'Salvando…' : 'Salvar ajustes'}
      </Button>
      {salvo ? (
        <Chip
          size="small"
          label="valendo no próximo lote"
          sx={{
            bgcolor: `${cores.sucesso}22`,
            color: cores.sucesso,
            border: '1px solid',
            borderColor: `${cores.sucesso}55`,
          }}
        />
      ) : null}
    </Stack>
  );

  return (
    <Moldura aoVoltar={aoVoltar} rodape={rodape}>
      <Stack spacing={1.5}>
        <Secao titulo="respostas" cor={cores.ciano}>
          <Linha
            titulo="Responder sozinho a partir de"
            explicacao="Acima disto a resposta já entra na lista de prontas. Menor = mais respostas, mais frouxas."
            detalhe="Abaixar enche a tela mais rápido, mas com respostas de que o copiloto tem menos certeza."
            valor={porcento(valores.limiarResposta)}
          >
            <Slider
              size="small"
              value={valores.limiarResposta}
              min={0.5}
              max={0.95}
              step={0.05}
              marks
              valueLabelDisplay="auto"
              valueLabelFormat={porcento}
              onChange={(_, v) => alterar({ limiarResposta: Number(v) })}
            />
          </Linha>
          <Linha
            titulo="Descartar abaixo de"
            explicacao="Abaixo disto a mensagem some sem virar rascunho — evita encher o painel de “kkkk”."
            detalhe="Mensagens sem pergunta nenhuma nem chegam a custar processamento."
            valor={porcento(valores.limiarDescarte)}
          >
            <Slider
              size="small"
              value={valores.limiarDescarte}
              min={0.05}
              max={0.5}
              step={0.05}
              marks
              valueLabelDisplay="auto"
              valueLabelFormat={porcento}
              onChange={(_, v) => alterar({ limiarDescarte: Number(v) })}
            />
          </Linha>
          <Linha
            titulo="Tamanho do lote"
            explicacao="Junta mensagens antes de analisar. Lote maior sai mais barato; menor responde mais rápido."
            valor={`${valores.tamanhoDoLote} msgs`}
            ultima
          >
            <Slider
              size="small"
              value={valores.tamanhoDoLote}
              min={LOTE_MINIMO}
              max={LOTE_MAXIMO}
              step={1}
              valueLabelDisplay="auto"
              onChange={(_, v) => alterar({ tamanhoDoLote: Number(v) })}
            />
          </Linha>
        </Secao>

        <Secao titulo="chat" cor={cores.ciano}>
          <Linha
            titulo="Lista negra"
            explicacao="Mensagens com qualquer destas palavras são ignoradas. Separe por vírgula."
            detalhe="O filtro roda antes de custar processamento."
          >
            <TextField
              fullWidth
              size="small"
              multiline
              minRows={1}
              value={listaNegraTexto}
              placeholder="golpe, link, whatsapp"
              onChange={(e) => {
                setListaNegraTexto(e.target.value);
                setSalvo(false);
              }}
            />
          </Linha>
          <Linha
            titulo="Bloquear espectadores"
            explicacao="Mensagens destes @ são ignoradas e não custam nada. Separe por vírgula."
            detalhe="A lista fica só neste computador."
            ultima
          >
            <TextField
              fullWidth
              size="small"
              multiline
              minRows={1}
              value={bloqueadosTexto}
              placeholder="@curioso_chato, @concorrente"
              onChange={(e) => {
                setBloqueadosTexto(e.target.value);
                setSalvo(false);
              }}
            />
          </Linha>
        </Secao>

        <Secao titulo="vitrine" cor={cores.ciano}>
          <Linha
            titulo="Rotação automática de produtos"
            explicacao="Fixa o próximo produto da base, em ordem, enquanto a live corre."
            detalhe="Se três fixações seguidas falharem, a rotação pausa sozinha e te avisa."
            controle={
              <Switch
                checked={valores.rotacaoDeProdutosAtiva}
                onChange={(_, ligado) => alterar({ rotacaoDeProdutosAtiva: ligado })}
              />
            }
            ultima={!valores.rotacaoDeProdutosAtiva}
          />
          {/* O intervalo só faz sentido com a rotação ligada; desligado, some
              em vez de ficar cinza ocupando linha. */}
          {valores.rotacaoDeProdutosAtiva ? (
            <Linha
              titulo="Intervalo entre produtos"
              explicacao="Tempo que cada produto fica fixado antes de passar para o próximo."
              valor={`${valores.rotacaoIntervaloMinutos} min`}
              ultima
            >
              <Slider
                size="small"
                value={valores.rotacaoIntervaloMinutos}
                min={2}
                max={60}
                step={1}
                valueLabelDisplay="auto"
                valueLabelFormat={(v) => `${v} min`}
                onChange={(_, v) => alterar({ rotacaoIntervaloMinutos: Number(v) })}
              />
            </Linha>
          ) : null}
        </Secao>

        <Secao titulo="proteção" cor={cores.atencao}>
          <Linha
            titulo="Detectar avisos do TikTok"
            explicacao="Com um aviso de restrição na live, o envio pausa na hora. Recomendado ligado."
            controle={
              <Switch
                checked={valores.detectorAvisoAtivo}
                onChange={(_, ligado) => alterar({ detectorAvisoAtivo: ligado })}
              />
            }
          />
          <Linha
            titulo="Encerrar a live ao detectar aviso"
            explicacao="ATENÇÃO: um aviso do TikTok ENCERRA a transmissão. Um alarme falso derruba a live."
            detalhe="Ligue só se preferir não correr nenhum risco com a conta. Depende do detector ligado."
            controle={
              <Switch
                color="warning"
                disabled={!valores.detectorAvisoAtivo}
                checked={valores.encerrarAoDetectarAviso}
                onChange={(_, ligado) => alterar({ encerrarAoDetectarAviso: ligado })}
              />
            }
            ultima
          />
        </Secao>

        <Secao titulo="sistema" cor={cores.ciano}>
          <Linha
            titulo="Atualizar sistema"
            explicacao="Baixa sozinho e instala ao fechar. O botão só adianta a conferência."
            detalhe="Útil antes de começar uma live."
          >
            <BlocoDeAtualizacao />
          </Linha>
          <Linha
            titulo="Manter o computador ativo"
            explicacao="Mexe o mouse 1 pixel a cada minuto enquanto o app estiver aberto, para o sistema não te dar como ausente numa live longa."
            detalhe="Você não percebe o movimento. Vale desde que o app abre, sem precisar entrar na live. No Linux precisa do xdotool instalado."
            controle={
              <Switch
                checked={valores.mexerMouseAutomatico}
                onChange={(_, ligado) => alterar({ mexerMouseAutomatico: ligado })}
              />
            }
          />
          <Linha
            titulo="Registro de erros"
            explicacao="O app anota sozinho todo erro num arquivo local. Se algo der errado numa live, é este arquivo que o suporte vai pedir."
            ultima
          >
            <Button
              variant="outlined"
              size="small"
              onClick={() => void ponte?.abrirLogs()}
            >
              Abrir pasta de logs
            </Button>
          </Linha>
        </Secao>

        <BlocoDaConta aoSair={aoSair} />
      </Stack>
    </Moldura>
  );
}

/**
 * Um bloco de ajustes afins: cabeçalho pequeno em caixa alta (o mesmo desenho
 * do `TituloDeSecao` do Cockpit) e as linhas separadas por um fio fino. É o
 * agrupamento, e não o cartão por controle, que deixa a tela escaneável.
 */
function Secao({
  titulo,
  cor,
  children,
}: {
  readonly titulo: string;
  readonly cor: string;
  readonly children: React.ReactNode;
}): JSX.Element {
  return (
    <Box>
      <Stack direction="row" alignItems="center" spacing={0.85} sx={{ mb: 0.5, ml: 0.25 }}>
        <Box sx={{ width: 3, height: 11, borderRadius: 999, bgcolor: cor, flexShrink: 0 }} />
        <Typography variant="overline" sx={{ color: cor, fontSize: 12, letterSpacing: 1.2 }}>
          {titulo}
        </Typography>
      </Stack>
      <Box
        sx={{
          px: 1.75,
          py: 0.5,
          borderRadius: 2,
          bgcolor: cores.superficie,
          border: '1px solid',
          borderColor: 'divider',
        }}
      >
        {children}
      </Box>
    </Box>
  );
}

/**
 * Uma linha de ajuste: título e legenda à esquerda, à direita o switch ou o
 * valor atual do slider. O `children` (slider, campo de texto, botões) entra
 * logo abaixo do título ocupando a largura toda. A legenda é curta de
 * propósito; o que não coube vai para o tooltip do título.
 */
function Linha({
  titulo,
  explicacao,
  detalhe,
  valor,
  controle,
  ultima = false,
  children,
}: {
  readonly titulo: string;
  readonly explicacao: string;
  /** Texto extra que aparece no tooltip do título, se houver. */
  readonly detalhe?: string;
  /** Valor atual em destaque à direita (ex.: "65%", "5 msgs", "10 min"). */
  readonly valor?: string;
  /** Controle que fica à direita na própria linha (switch). */
  readonly controle?: React.ReactNode;
  /** Sem o separador embaixo — última linha da seção. */
  readonly ultima?: boolean;
  readonly children?: React.ReactNode;
}): JSX.Element {
  const rotulo = (
    <Typography
      variant="body2"
      fontWeight={600}
      sx={
        detalhe
          ? {
              cursor: 'help',
              textDecoration: 'underline dotted',
              textDecorationColor: alpha('#ffffff', 0.25),
              textUnderlineOffset: 3,
            }
          : undefined
      }
    >
      {titulo}
    </Typography>
  );
  return (
    <>
      <Box sx={{ py: 1 }}>
        <Stack direction="row" alignItems="center" spacing={1.5}>
          <Box sx={{ flex: 1, minWidth: 0 }}>
            {detalhe ? (
              <Tooltip title={detalhe} placement="top-start" enterDelay={300}>
                <Box component="span" sx={{ display: 'inline-block' }}>
                  {rotulo}
                </Box>
              </Tooltip>
            ) : (
              rotulo
            )}
            <Typography
              variant="caption"
              color="text.secondary"
              component="p"
              noWrap
              sx={{ lineHeight: 1.4 }}
            >
              {explicacao}
            </Typography>
          </Box>
          {valor ? (
            <Typography
              variant="body2"
              sx={{
                fontWeight: 750,
                color: cores.ciano,
                fontVariantNumeric: 'tabular-nums',
                flexShrink: 0,
              }}
            >
              {valor}
            </Typography>
          ) : null}
          {controle ? <Box sx={{ flexShrink: 0, mr: -1 }}>{controle}</Box> : null}
        </Stack>
        {children ? <Box sx={{ mt: 0.5, px: 0.5 }}>{children}</Box> : null}
      </Box>
      {ultima ? null : <Divider />}
    </>
  );
}

/**
 * Cabeçalho, área que rola e, se houver, um rodapé fixo. O rodapé fica FORA
 * da área rolável para que "Salvar" esteja sempre à vista — antes ele ficava
 * no fim de 1.800 px de rolagem.
 */
function Moldura({
  children,
  aoVoltar,
  rodape,
}: {
  readonly children: React.ReactNode;
  readonly aoVoltar: () => void;
  readonly rodape?: React.ReactNode;
}): JSX.Element {
  return (
    <Stack sx={{ height: '100%', minHeight: 0 }}>
      <Stack direction="row" alignItems="center" sx={{ px: 3, pt: 2, pb: 1.5 }}>
        <Typography variant="h5" sx={{ flex: 1 }}>
          Ajustes
        </Typography>
        <Button size="small" color="inherit" onClick={aoVoltar}>
          Voltar
        </Button>
      </Stack>
      <Box sx={{ flex: 1, minHeight: 0, overflowY: 'auto', px: 3, pb: 2 }}>{children}</Box>
      {rodape ? (
        <Box
          sx={{
            px: 3,
            py: 1.5,
            borderTop: '1px solid',
            borderColor: 'divider',
            bgcolor: cores.fundo,
            flexShrink: 0,
          }}
        >
          {rodape}
        </Box>
      ) : null}
    </Stack>
  );
}

/**
 * O canto do "atualizar sistema": versão atual, estado do updater e o botão
 * que adianta a checagem. O download continua automático — este bloco só dá ao
 * vendedor o gesto e a resposta ("você já está na mais recente") que o fluxo
 * silencioso não tem como dar.
 */
function BlocoDeAtualizacao(): JSX.Element {
  const ponte = obterPonte();
  const estado = useEstadoAtualizacao();
  const [versao, setVersao] = useState('');
  const [checando, setChecando] = useState(false);
  const [checou, setChecou] = useState(false);

  useEffect(() => {
    ponte?.obterVersao().then(setVersao).catch(() => undefined);
  }, [ponte]);

  const verificar = async (): Promise<void> => {
    if (!ponte) return;
    setChecando(true);
    try {
      await ponte.verificarAtualizacao();
      setChecou(true);
    } finally {
      setChecando(false);
    }
  };

  const situacao = estado?.situacao ?? 'ociosa';
  const linha =
    situacao === 'pronta'
      ? `Versão ${estado?.versao ?? 'nova'} baixada — reinicie para aplicar.`
      : situacao === 'baixando'
        ? `Baixando a versão ${estado?.versao ?? 'nova'}… ${estado?.progresso ?? 0}%`
        : situacao === 'atualizada'
          ? 'Você já está na versão mais recente.'
          : situacao === 'falhou' && checou
            ? (estado?.erro ?? 'Não deu para verificar agora. Tente de novo em instantes.')
            : null;

  return (
    <Stack spacing={0.75}>
      <Stack direction="row" spacing={1.25} alignItems="center" flexWrap="wrap" useFlexGap>
        <Button
          variant="outlined"
          color="inherit"
          size="small"
          disabled={checando || situacao === 'baixando'}
          onClick={() => void verificar()}
        >
          {checando ? 'Verificando…' : 'Verificar atualização'}
        </Button>
        {situacao === 'pronta' ? (
          <Button
            variant="contained"
            size="small"
            onClick={() => void ponte?.instalarAtualizacao()}
          >
            Reiniciar e atualizar
          </Button>
        ) : null}
        {versao ? (
          <Chip size="small" variant="outlined" label={`versão ${versao}`} />
        ) : null}
      </Stack>
      {linha ? (
        <Typography variant="caption" color="text.secondary">
          {linha}
        </Typography>
      ) : null}
    </Stack>
  );
}

const porcento = (v: number): string => `${Math.round(v * 100)}%`;

/** Aceita vírgula e quebra de linha, porque quem cola uma lista usa as duas. */
function separarPalavras(texto: string): string[] {
  return texto
    .split(/[,\n]/)
    .map((p) => p.trim().toLowerCase())
    .filter((p) => p.length > 0);
}
