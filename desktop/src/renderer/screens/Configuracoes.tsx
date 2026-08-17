import LogoutIcon from '@mui/icons-material/Logout';
import PersonIcon from '@mui/icons-material/PersonOutline';
import {
  Box,
  Button,
  Chip,
  CircularProgress,
  Slider,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import { useCallback, useEffect, useState } from 'react';
import type { ConfiguracoesCopiloto, SessaoDesktop } from '@shared/desktop-api';
import { LOTE_MAXIMO, LOTE_MINIMO } from '@shared/desktop-api';
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
  const [sessao, setSessao] = useState<SessaoDesktop | null>(null);
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

  useEffect(() => {
    // A sessão é só para MOSTRAR de quem é a conta antes de sair dela. Se a
    // leitura falhar, o bloco de conta ainda aparece com o botão: não saber o
    // e-mail não pode impedir alguém de deslogar.
    if (!ponte) return;
    void ponte.obterSessao().then(setSessao).catch(() => undefined);
  }, [ponte]);

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

        <BlocoDaConta sessao={sessao} aoSair={aoSair} />
      </Stack>
    </Moldura>
  );
}

/**
 * De quem é esta conta, e como sair dela.
 *
 * Fica NOS AJUSTES porque é o único lugar alcançável das duas telas em que o
 * app fica parado — o cockpit tem a engrenagem no cabeçalho e a tela de
 * conectar tem o botão embaixo. Sair não é um ajuste, mas espalhar um segundo
 * caminho por fora custaria mais do que o vendedor ganha: ele desloga uma vez
 * na vida do computador, e o que ele não pode é ter que desinstalar o app para
 * trocar de conta — que era exatamente o estado anterior.
 *
 * A confirmação existe por causa de UM caso: sair no meio de uma live encerra
 * a run. Fora dele o clique não perde nada.
 */
function BlocoDaConta({
  sessao,
  aoSair,
}: {
  readonly sessao: SessaoDesktop | null;
  readonly aoSair: () => void;
}): JSX.Element {
  const ponte = obterPonte();
  const [confirmando, setConfirmando] = useState(false);
  const [saindo, setSaindo] = useState(false);

  const sair = async (): Promise<void> => {
    if (!ponte) return;
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
        <Stack spacing={1.25}>
          <Typography variant="body2" color="text.secondary" sx={{ lineHeight: 1.55 }}>
            Sair encerra a live que estiver no ar e este computador precisará de
            um código novo para entrar de novo. Seus minutos e suas bases não
            são afetados.
          </Typography>
          <Stack direction="row" spacing={1}>
            <Button
              size="small"
              variant="contained"
              color="error"
              onClick={() => void sair()}
              disabled={saindo}
              startIcon={saindo ? <CircularProgress size={14} color="inherit" /> : null}
            >
              {saindo ? 'Saindo…' : 'Sim, sair da conta'}
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
      ) : (
        <Button
          size="small"
          variant="outlined"
          color="inherit"
          startIcon={<LogoutIcon sx={{ fontSize: 16 }} />}
          onClick={() => setConfirmando(true)}
        >
          Sair da conta
        </Button>
      )}
    </Box>
  );
}

/**
 * Cada ajuste vira um card próprio.
 *
 * Empilhados soltos, os quatro controles liam como um formulário — e um slider
 * sem moldura, no escuro, não deixa claro até onde vai o ajuste que ele
 * controla e onde começa a explicação do seguinte.
 */
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

const porcento = (v: number): string => `${Math.round(v * 100)}%`;

/** Aceita vírgula e quebra de linha, porque quem cola uma lista usa as duas. */
function separarPalavras(texto: string): string[] {
  return texto
    .split(/[,\n]/)
    .map((p) => p.trim().toLowerCase())
    .filter((p) => p.length > 0);
}
