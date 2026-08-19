import {
  Box,
  Button,
  Chip,
  Slider,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import { useCallback, useEffect, useState } from 'react';
import type { ConfiguracoesCopiloto } from '@shared/desktop-api';
import { LOTE_MAXIMO, LOTE_MINIMO } from '@shared/desktop-api';
import { BlocoDaConta } from '../components/BlocoDaConta';
import { Aviso, Carregando } from '../components/Estados';
import { mensagemDeErro } from '../erros';
import { cores } from '../theme/theme';
import { SEM_PONTE, obterPonte } from '../ponte';

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

  const carregar = useCallback(async (): Promise<void> => {
    if (!ponte) return;
    setErro(null);
    try {
      const lidos = await ponte.lerConfiguracoes();
      setValores(lidos);
      setListaNegraTexto(lidos.listaNegra.join(', '));
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
      });
      setValores(gravados);
      setListaNegraTexto(gravados.listaNegra.join(', '));
      setSalvo(true);
    } catch (e) {
      setErro(mensagemDeErro(e));
    } finally {
      setSalvando(false);
    }
  };

  return (
    <Moldura aoVoltar={aoVoltar}>
      <Stack spacing={1.75}>
        <Ajuste
          titulo="Responder sozinho a partir de"
          explicacao={`Acima de ${porcento(valores.limiarResposta)} de certeza, a resposta já entra na lista de prontas. Baixar isso enche a tela mais rápido, mas com respostas mais frouxas.`}
        >
          <Slider
            value={valores.limiarResposta}
            min={0.5}
            max={0.95}
            step={0.05}
            marks
            valueLabelDisplay="auto"
            valueLabelFormat={porcento}
            onChange={(_, v) => alterar({ limiarResposta: Number(v) })}
          />
        </Ajuste>

        <Ajuste
          titulo="Descartar abaixo de"
          explicacao={`Abaixo de ${porcento(valores.limiarDescarte)} a pergunta some sem virar nem rascunho. É o que evita o painel encher de "kkkk" e de mensagem sem pergunta nenhuma.`}
        >
          <Slider
            value={valores.limiarDescarte}
            min={0.05}
            max={0.5}
            step={0.05}
            marks
            valueLabelDisplay="auto"
            valueLabelFormat={porcento}
            onChange={(_, v) => alterar({ limiarDescarte: Number(v) })}
          />
        </Ajuste>

        <Ajuste
          titulo="Lista negra"
          explicacao="Mensagens que contêm qualquer uma destas palavras são ignoradas antes de custar processamento. Separe por vírgula."
        >
          <TextField
            fullWidth
            multiline
            minRows={2}
            value={listaNegraTexto}
            placeholder="golpe, link, whatsapp"
            onChange={(e) => {
              setListaNegraTexto(e.target.value);
              setSalvo(false);
            }}
          />
        </Ajuste>

        <Ajuste
          titulo="Tamanho do lote"
          explicacao={`Junto até ${valores.tamanhoDoLote} mensagens antes de mandar para análise. Lote maior sai mais barato; lote menor responde mais rápido.`}
        >
          <Slider
            value={valores.tamanhoDoLote}
            min={LOTE_MINIMO}
            max={LOTE_MAXIMO}
            step={1}
            valueLabelDisplay="auto"
            onChange={(_, v) => alterar({ tamanhoDoLote: Number(v) })}
          />
        </Ajuste>

        <Stack direction="row" spacing={1.25} alignItems="center" sx={{ pt: 0.5 }}>
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

        <Ajuste
          titulo="Atualizar sistema"
          explicacao="O app baixa as atualizações sozinho e instala quando você fecha. Este botão só adianta a conferência — útil antes de começar uma live."
        >
          <BlocoDeAtualizacao />
        </Ajuste>

        <BlocoDaConta aoSair={aoSair} />
      </Stack>
    </Moldura>
  );
}

function Ajuste({
  titulo,
  explicacao,
  children,
}: {
  readonly titulo: string;
  readonly explicacao: string;
  readonly children: React.ReactNode;
}): JSX.Element {
  return (
    <Box
      sx={{
        p: 2,
        borderRadius: 3,
        bgcolor: cores.superficie,
        border: '1px solid',
        borderColor: 'divider',
      }}
    >
      <Typography variant="subtitle2" fontWeight={800}>
        {titulo}
      </Typography>
      <Typography
        variant="caption"
        color="text.secondary"
        component="p"
        sx={{ mb: 1.5, mt: 0.35, lineHeight: 1.55 }}
      >
        {explicacao}
      </Typography>
      {children}
    </Box>
  );
}

function Moldura({
  children,
  aoVoltar,
}: {
  readonly children: React.ReactNode;
  readonly aoVoltar: () => void;
}): JSX.Element {
  return (
    <Stack spacing={2} sx={{ p: 3, pt: 2, overflowY: 'auto', height: '100%' }}>
      <Stack direction="row" alignItems="center">
        <Typography variant="h5" sx={{ flex: 1 }}>
          Ajustes
        </Typography>
        <Button size="small" color="inherit" onClick={aoVoltar}>
          Voltar
        </Button>
      </Stack>
      {children}
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
        ? `Baixando a versão ${estado?.versao ?? 'nova'}…`
        : situacao === 'atualizada'
          ? 'Você já está na versão mais recente.'
          : situacao === 'falhou' && checou
            ? (estado?.erro ?? 'Não deu para verificar agora. Tente de novo em instantes.')
            : null;

  return (
    <Stack spacing={1.25}>
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
