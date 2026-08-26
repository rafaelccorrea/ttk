import {
  Box,
  Button,
  MenuItem,
  Stack,
  TextField,
  Typography,
  alpha,
} from '@mui/material';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { BaseDeConhecimento, CarteiraLive } from '@shared/desktop-api';
import { MINIMO_SEGUIDORES_LIVE } from '@shared/desktop-api';
import { BlocoDaConta } from '../components/BlocoDaConta';
import { Aviso, Carregando } from '../components/Estados';
import { mensagemDeErro } from '../erros';
import { LINKS } from '../links';
import { cores } from '../theme/theme';
import { SEM_PONTE, obterPonte } from '../ponte';
import { useEstadoAtualizacao } from '../hooks/useEstadoAtualizacao';
import { useTikTokLogado } from '../hooks/useTikTokLogado';

const PASSOS_DA_CONEXAO = [
  'Abrindo a transmissão…',
  'Ligando a leitura do chat…',
  'Preparando as respostas…',
];

/**
 * De quanto em quanto tempo a espera guiada confere se a live entrou no ar.
 *
 * Mais curto que os 30s do modo foco de propósito: aqui o vendedor acabou de
 * clicar em "Entrar na live" e está com o celular na mão — cada segundo de
 * atraso entre "fui ao vivo" e "o copiloto conectou" parece falha do app.
 */
const INTERVALO_ESPERA_MS = 15_000;

/**
 * A página oficial de download do TikTok LIVE Studio — o único jeito de abrir
 * uma live pelo computador. Conferida em 2026-08: é o domínio do TikTok, não um
 * espelho de terceiro.
 */
const URL_LIVE_STUDIO = 'https://www.tiktok.com/studio/download';

/**
 * Tela 2 — escolher a base e entrar na live.
 *
 * São duas decisões e nada mais: SOBRE O QUE o copiloto responde e QUAL live
 * ele está assistindo. Tudo o que não for uma dessas duas coisas atrapalha
 * alguém que já está com a câmera ligada esperando para começar.
 *
 * O saldo aparece ANTES de conectar, e não numa fatura depois, porque o minuto
 * é debitado em batimento durante a transmissão: quem entra com quatro minutos
 * precisa saber disso enquanto ainda dá para comprar mais.
 */
export function ConectarLive({
  aoConectar,
  aoAbrirConfiguracoes,
  aoSair,
}: {
  readonly aoConectar: () => void;
  readonly aoAbrirConfiguracoes: () => void;
  /** Chamado depois do logout: o shell volta para a tela de ativação. */
  readonly aoSair: () => void;
}): JSX.Element {
  const ponte = obterPonte();
  const tiktokLogado = useTikTokLogado();
  const atualizacao = useEstadoAtualizacao();
  const [bases, setBases] = useState<BaseDeConhecimento[] | null>(null);
  const [carteira, setCarteira] = useState<CarteiraLive | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [baseId, setBaseId] = useState('');
  const [usuario, setUsuario] = useState('');
  const [conectando, setConectando] = useState(false);
  const [passoConexao, setPassoConexao] = useState(0);
  const [erroConexao, setErroConexao] = useState<string | null>(null);
  /**
   * Seguidores da conta digitada. `null` = não sei, e não sei é silêncio.
   *
   * A leitura sai da página pública do perfil, com a sessão do próprio app, e
   * falha calada em qualquer tropeço. É indicação, não veredito: o TikTok não
   * publica elegibilidade de live, e idade, região e restrição de conta também
   * contam. Por isso este número NÃO entra no `disabled` do botão.
   */
  const [seguidores, setSeguidores] = useState<number | null>(null);
  /** A leitura do @ terminou (com ou sem nome) — separa "lendo" de "falhou". */
  const [leuUsuario, setLeuUsuario] = useState(false);
  /**
   * A espera guiada: o vendedor clicou em entrar, mas a live ainda não está no
   * ar. Em vez de um erro ("comece a transmissão primeiro") a tela vira um
   * passo a passo de como abrir a live no TikTok, e o app conecta SOZINHO
   * assim que detectar a transmissão — ninguém precisa voltar e clicar de novo.
   */
  const [aguardando, setAguardando] = useState(false);
  /**
   * O `conectar` desta renderização, para a espera chamar sem fechar sobre uma
   * versão velha de `baseId`/`usuario`. A função é declarada mais abaixo
   * (depois dos retornos condicionais), então ela chega aqui por ref.
   */
  const conectarRef = useRef<(() => Promise<void>) | null>(null);

  /*
   * O @ NÃO é digitável: é a conta logada na view ao lado, lida pelo app.
   *
   * A regra do produto é uma só — o copiloto acompanha a live de quem está
   * logado ali. O campo aberto era duas portas de erro com um custo cada: o
   * erro de digitação conectava (e cobrava) o copiloto na live de um estranho,
   * e o @ de outra conta prometia uma live que o app não conseguiria nem ler
   * nem responder, já que a sessão é a da conta ao lado. Para transmitir por
   * outra conta, troca-se o LOGIN à esquerda — e esta leitura acompanha.
   */
  useEffect(() => {
    if (!ponte || tiktokLogado !== true) return undefined;
    let valendo = true;
    setLeuUsuario(false);
    void ponte
      .usuarioDoTikTok()
      .then((nome) => {
        if (!valendo) return;
        setUsuario(nome ? `@${nome}` : '');
        setLeuUsuario(true);
      })
      .catch(() => {
        if (!valendo) return;
        setUsuario('');
        setLeuUsuario(true);
      });
    return () => {
      valendo = false;
    };
  }, [ponte, tiktokLogado]);

  /*
   * A consulta espera a digitação parar. Sem a folga, cada tecla do @ viraria
   * uma visita ao tiktok.com — dezenas de requisições para um dado que só
   * interessa quando o nome está inteiro.
   */
  useEffect(() => {
    if (!ponte) return undefined;
    const alvo = usuario.trim();
    setSeguidores(null);
    if (alvo.length < 2) return undefined;
    // A resposta de um @ antigo não pode pintar a tela do @ novo: a limpeza
    // deste efeito derruba a anterior antes de a próxima começar.
    let valendo = true;
    const id = setTimeout(() => {
      void ponte
        .seguidoresDoTikTok(alvo)
        .then((n) => {
          if (valendo) setSeguidores(n);
        })
        .catch(() => {
          if (valendo) setSeguidores(null);
        });
    }, 700);
    return () => {
      valendo = false;
      clearTimeout(id);
    };
  }, [ponte, usuario]);

  /*
   * O "conectando" narrado. A conexão real atravessa três etapas (abrir a run,
   * ligar o chat, preparar as respostas) e pode levar vários segundos em rede
   * ruim — um botão parado em "Entrando…" nesse tempo parece travado. Os
   * passos são cadenciados por tempo, não pelos eventos reais: é narração de
   * espera, e a ordem bate com o que acontece de verdade.
   *
   * Este efeito mora AQUI EM CIMA, com os outros hooks, por obrigação e não
   * por estética: abaixo há retornos condicionais, e um hook depois deles
   * muda a contagem entre renders — o React derruba a árvore inteira e o
   * painel vira uma tela preta.
   */
  useEffect(() => {
    if (!conectando) {
      setPassoConexao(0);
      return undefined;
    }
    const id = window.setInterval(
      () => setPassoConexao((p) => Math.min(p + 1, PASSOS_DA_CONEXAO.length - 1)),
      1_500,
    );
    return () => window.clearInterval(id);
  }, [conectando]);

  /*
   * A vigia da espera guiada: enquanto o passo a passo está na tela, o app
   * confere de tempos em tempos se a live entrou no ar e, quando entrar,
   * dispara a MESMA conexão do botão — com a mesma validação e a mesma
   * cobrança. A primeira conferência já aconteceu no clique (é ela que abre a
   * espera), então aqui só o intervalo trabalha. `null` da leitura é "não
   * sei", e não conecta: conectar no palpite abriria uma run que cobra minuto.
   */
  useEffect(() => {
    if (!ponte || !aguardando) return undefined;
    const alvo = usuario.trim();
    if (!alvo) return undefined;
    let valendo = true;
    const id = window.setInterval(() => {
      void ponte
        .aoVivoNoTikTok(alvo)
        .then((noAr) => {
          if (valendo && noAr === true) void conectarRef.current?.();
        })
        .catch(() => undefined);
    }, INTERVALO_ESPERA_MS);
    return () => {
      valendo = false;
      window.clearInterval(id);
    };
  }, [ponte, aguardando, usuario]);

  const carregar = useCallback(async (): Promise<void> => {
    if (!ponte) return;
    setErro(null);
    try {
      // As duas juntas: mostrar a lista sem o saldo faria o vendedor escolher
      // uma base para só então descobrir que não tem minuto para usá-la.
      const [listadas, saldo] = await Promise.all([
        ponte.listarBases(),
        ponte.obterCarteiraLive(),
      ]);
      setBases(listadas);
      setCarteira(saldo);
      if (listadas.length === 1) setBaseId(listadas[0]!.id);
    } catch (e) {
      setErro(mensagemDeErro(e));
    }
  }, [ponte]);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  if (!ponte) {
    return (
      <Moldura
        titulo="Conectar à live"
        subtitulo="Escolha sobre o que eu respondo e qual live eu vou acompanhar."
        aoSair={aoSair}
      >
        <Aviso tom="erro" titulo="Não consegui carregar suas bases" descricao={SEM_PONTE} />
      </Moldura>
    );
  }

  if (erro) {
    return (
      <Moldura
        titulo="Conectar à live"
        subtitulo="Escolha sobre o que eu respondo e qual live eu vou acompanhar."
        aoSair={aoSair}
      >
        <Aviso
          tom="erro"
          titulo="Não consegui falar com o PikPok"
          descricao={erro}
          acao={{ rotulo: 'Tentar de novo', aoClicar: () => void carregar() }}
        />
      </Moldura>
    );
  }

  if (!bases || !carteira) {
    return (
      <Moldura
        titulo="Conectar à live"
        subtitulo="Escolha sobre o que eu respondo e qual live eu vou acompanhar."
        aoSair={aoSair}
      >
        <Carregando texto="Procurando suas bases de conhecimento…" />
      </Moldura>
    );
  }

  if (bases.length === 0) {
    return (
      <Moldura
        titulo="Conectar à live"
        subtitulo="Escolha sobre o que eu respondo e qual live eu vou acompanhar."
        aoSair={aoSair}
      >
        <Aviso
          titulo="Você ainda não tem uma base pronta"
          descricao={
            'O copiloto responde a partir de uma live sua já gravada: suba a gravação no site do PikPok, confira os produtos e os preços que a IA extraiu e marque a base como pronta. Aí ela aparece aqui.'
          }
          acao={{
            rotulo: 'Abrir o PikPok no navegador',
            aoClicar: () => void ponte.abrirNoNavegador(LINKS.copiloto),
          }}
        />
      </Moldura>
    );
  }

  const semSaldo =
    !carteira.ilimitada && carteira.minutos <= 0 && !carteira.trialDisponivel;
  /*
   * Sem sessão do TikTok o copiloto não lê o chat nem digita nele: entrar na
   * live abriria uma run que COBRA minuto e não teria como entregar resposta
   * nenhuma. Só bloqueia no `false` — no `null` a leitura ainda não voltou, e
   * travar o botão por não saber seguraria quem está logado.
   */
  const semTikTok = tiktokLogado === false;
  /*
   * Versão nova baixada = live nova só depois de atualizar.
   *
   * A regra do updater — nada reinicia durante uma live — continua de pé: o
   * bloqueio é SÓ nesta porta, antes de haver live para derrubar, e é o único
   * momento em que reiniciar não custa nada ao vendedor. Deixar entrar
   * desatualizado era como as correções de resposta e de leitura de chat
   * demoravam dias para chegar em quem mais precisava delas: o app fica aberto
   * o dia inteiro e o "instala quando fechar" nunca chegava.
   *
   * Só o estado 'pronta' trava — é o único com ação de zero espera. Download em
   * andamento ou falho não seguram ninguém: a live de hoje não pode depender da
   * banda ou do GitHub agora.
   */
  const precisaAtualizar = atualizacao?.situacao === 'pronta';

  const conectar = async (simulada = false): Promise<void> => {
    if (conectando) return;
    setConectando(true);
    setErroConexao(null);
    try {
      /*
       * A live ainda não está no ar? Então o clique não vira erro: vira a
       * espera guiada — o passo a passo de como abrir a transmissão, com o
       * app vigiando para conectar sozinho. Só o `false` explícito abre a
       * espera; `null` ("não consegui ler") segue para o conectar, onde o
       * processo principal repete a mesma conferência antes de cobrar.
       */
      if (!simulada) {
        const aoVivo = await ponte
          .aoVivoNoTikTok(usuario.trim())
          .catch(() => null);
        if (aoVivo === false) {
          setAguardando(true);
          return;
        }
      }
      await ponte.conectar({
        knowledgeSessionId: baseId,
        // Na simulação não há transmissão de verdade: o @ é decorativo e o
        // fallback cobre quem nem chegou a logar no TikTok.
        tiktokUsername: usuario.trim() || '@live.simulada',
        simulada,
      });
      setAguardando(false);
      aoConectar();
    } catch (e) {
      const mensagem = mensagemDeErro(e);
      /*
       * A corrida perdida: entre a conferência acima e a abertura da run, a
       * live pode ter caído (ou a leitura de lá enxergou o que a daqui não
       * viu). O texto vem do processo principal e é a única marca disponível —
       * se ele mudar, o pior caso é a espera virar o erro antigo de novo.
       */
      if (!simulada && /ainda não está no ar/i.test(mensagem)) {
        setAguardando(true);
        return;
      }
      setAguardando(false);
      setErroConexao(mensagem);
    } finally {
      setConectando(false);
    }
  };
  conectarRef.current = () => conectar();


  return (
    <Moldura
      titulo="Conectar à live"
      subtitulo="Escolha sobre o que eu respondo e qual live eu vou acompanhar."
      aoSair={aoSair}
    >
      <Stack spacing={2.5}>
        <Box
          sx={{
            position: 'relative',
            overflow: 'hidden',
            p: 2.25,
            borderRadius: 3.5,
            bgcolor: cores.superficieAlta,
            border: '1px solid',
            borderColor: carteira.trialDisponivel ? alpha(cores.ciano, 0.35) : 'divider',
            // O trial é a única boa notícia desta tela, então ele ganha o ciano
            // da marca lavando o canto do card. Sem trial o mesmo card fica
            // neutro: saldo comprado é fato, não celebração.
            '&::before': carteira.trialDisponivel
              ? {
                  content: '""',
                  position: 'absolute',
                  inset: 0,
                  background: `radial-gradient(90% 120% at 100% 0%, ${alpha(cores.ciano, 0.16)} 0%, transparent 65%)`,
                }
              : undefined,
            '& > *': { position: 'relative' },
          }}
        >
          <Typography variant="overline" color="text.secondary">
            minutos de live
          </Typography>
          <Stack direction="row" alignItems="baseline" spacing={0.75} sx={{ mt: 0.25 }}>
            <Typography
              variant="h4"
              sx={{
                fontVariantNumeric: 'tabular-nums',
                lineHeight: 1,
                background: carteira.trialDisponivel ? cores.gradiente : 'none',
                WebkitBackgroundClip: carteira.trialDisponivel ? 'text' : undefined,
                WebkitTextFillColor: carteira.trialDisponivel ? 'transparent' : undefined,
              }}
            >
              {carteira.ilimitada ? '∞' : carteira.minutos}
            </Typography>
            <Typography variant="subtitle2" color="text.secondary">
              {carteira.ilimitada ? 'ilimitado' : 'min'}
            </Typography>
          </Stack>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.85, lineHeight: 1.5 }}>
            {carteira.ilimitada
              ? 'Conta da equipe: nenhum minuto é descontado.'
              : carteira.trialDisponivel
                ? `Os primeiros ${carteira.trialMinutos} minutos são por nossa conta — entram assim que você conectar.`
                : 'Cada minuto no ar desconta um daqui.'}
          </Typography>
        </Box>

        <TextField
          select
          fullWidth
          label="Base de conhecimento"
          value={baseId}
          onChange={(e) => setBaseId(e.target.value)}
          helperText="É daqui que saem os preços, as variações e o frete das respostas."
        >
          {bases.map((base) => (
            <MenuItem key={base.id} value={base.id}>
              <Stack>
                <Typography variant="body2" fontWeight={700}>
                  {base.title}
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  {base.produtos} produtos · {base.faqs} respostas prontas · ~{base.tokensAprox} tokens/chamada
                </Typography>
              </Stack>
            </MenuItem>
          ))}
        </TextField>

        <TextField
          fullWidth
          label="Perfil da live no TikTok"
          value={
            usuario ||
            (tiktokLogado === true && !leuUsuario ? 'Lendo a conta logada…' : '')
          }
          InputProps={{ readOnly: true }}
          helperText={
            usuario
              ? 'É a conta logada no TikTok aqui do lado. Para transmitir por outra, troque o login à esquerda.'
              : leuUsuario && tiktokLogado === true
                ? 'Não consegui ler o @ da conta logada. Recarregue a tela do TikTok ao lado e volte aqui.'
                : 'O @ aparece sozinho assim que você estiver logado no TikTok ao lado.'
          }
        />

        {semSaldo ? (
          <Aviso
            titulo="Seus minutos acabaram"
            descricao="Compre um pacote de horas no site para o copiloto voltar a acompanhar o chat."
            acao={{
              rotulo: 'Comprar horas',
              aoClicar: () => void ponte.abrirNoNavegador(LINKS.planos),
            }}
          />
        ) : null}

        {/*
          Aviso, e não bloqueio: o botão continua clicável de propósito. A
          leitura é uma inferência sobre a regra pública do TikTok, e travar a
          live com base nela impediria quem já pode transmitir toda vez que a
          regra mudasse ou o número viesse errado.
        */}
        {seguidores !== null && seguidores < MINIMO_SEGUIDORES_LIVE ? (
          <Aviso
            titulo="Essa conta talvez ainda não possa fazer live"
            descricao={`O @${usuario.trim().replace(/^@/, '')} tem ${seguidores.toLocaleString('pt-BR')} seguidores, e o TikTok costuma pedir ${MINIMO_SEGUIDORES_LIVE.toLocaleString('pt-BR')} para liberar a transmissão. Se a sua live já está no ar, pode seguir — este aviso é só uma conferência, e quem decide é o TikTok.`}
          />
        ) : null}

        {precisaAtualizar ? (
          <Aviso
            titulo="Atualize antes de entrar na live"
            descricao={`A versão ${atualizacao?.versao ?? 'nova'} já está baixada — o app reabre nela em segundos. Entrar na live com a versão antiga deixaria você sem as correções mais recentes de leitura do chat e de respostas.`}
            acao={{
              rotulo: 'Atualizar e reabrir agora',
              aoClicar: () => void ponte.instalarAtualizacao(),
            }}
          />
        ) : null}

        {semTikTok ? (
          <Aviso
            titulo="Entre na sua conta do TikTok"
            descricao="A tela do TikTok aqui do lado está deslogada. É por ela que eu leio as perguntas do chat e escrevo as respostas — sem esse login não dá para acompanhar a live. Assim que você entrar, este aviso some sozinho."
          />
        ) : null}

        {erroConexao ? (
          <Aviso
            tom="erro"
            titulo="Não consegui entrar na live"
            descricao={erroConexao}
            acao={{ rotulo: 'Tentar de novo', aoClicar: () => void conectar() }}
          />
        ) : null}

        {/*
          O checklist do decolar: os três pré-requisitos num relance, cada um
          virando verde conforme se resolve. Antes cada um só aparecia como um
          erro na hora do clique — descoberta em série é o que faz a primeira
          live parecer difícil.
        */}
        <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
          <ItemDeChecklist ok={tiktokLogado === true} rotulo="TikTok logado" />
          <ItemDeChecklist ok={Boolean(baseId)} rotulo="Base escolhida" />
          <ItemDeChecklist
            ok={!semSaldo}
            rotulo={carteira.trialDisponivel ? 'Minutos de teste prontos' : 'Minutos na carteira'}
          />
        </Stack>

        {aguardando ? (
          <EsperaGuiada
            conectando={conectando}
            passo={PASSOS_DA_CONEXAO[passoConexao] ?? PASSOS_DA_CONEXAO[0]!}
            aoCancelar={() => setAguardando(false)}
            aoBaixarLiveStudio={() =>
              void ponte.abrirNoNavegador(URL_LIVE_STUDIO)
            }
          />
        ) : (
          <Button
            fullWidth
            size="large"
            variant="contained"
            disabled={
              !baseId ||
              usuario.trim().length === 0 ||
              conectando ||
              semSaldo ||
              semTikTok ||
              precisaAtualizar
            }
            onClick={() => void conectar()}
          >
            {conectando
              ? PASSOS_DA_CONEXAO[passoConexao]
              : precisaAtualizar
                ? 'Atualize para entrar na live'
                : semTikTok
                  ? 'Entre no TikTok para continuar'
                  : 'Entrar na live'}
          </Button>
        )}

        <Stack direction="row" spacing={1} alignItems="center" justifyContent="space-between">
          {/*
            A porta da demonstração: uma live inteira de mentira — chat
            roteirizado, entrega sem tocar o TikTok — com a IA e a cobrança de
            verdade. É como um vendedor cético entende o produto ANTES da
            primeira transmissão real; o custo em minutos é o mesmo, e o
            cockpit rotula tudo como "live de teste".
          */}
          <Button
            size="small"
            color="inherit"
            disabled={!baseId || conectando || semSaldo || precisaAtualizar}
            onClick={() => void conectar(true)}
          >
            Testar sem estar em live
          </Button>
          <Button size="small" color="inherit" onClick={aoAbrirConfiguracoes}>
            Ajustes
          </Button>
        </Stack>
      </Stack>
    </Moldura>
  );
}

/**
 * O passo a passo de entrar ao vivo, no lugar do botão de conectar.
 *
 * É a resposta ao maior tropeço do app: o vendedor clicava em "Entrar na
 * live", recebia "comece a transmissão no TikTok primeiro" e ficava perdido —
 * o app nunca dizia COMO começar, nem percebia quando ele começava. Aqui a
 * tela ensina o caminho (celular, que é o comum, e LIVE Studio para quem
 * transmite do computador) e promete o que a vigia acima cumpre: detectou a
 * live no ar → conecta sozinho, sem clique nenhum.
 *
 * Iniciar a transmissão DE DENTRO do app não existe por limite do TikTok, não
 * nosso: não há API pública para abrir uma live, e a criação só acontece no
 * app do celular ou no LIVE Studio (um programa próprio deles).
 */
function EsperaGuiada({
  conectando,
  passo,
  aoCancelar,
  aoBaixarLiveStudio,
}: {
  readonly conectando: boolean;
  readonly passo: string;
  readonly aoCancelar: () => void;
  /** Abre a página oficial do TikTok LIVE Studio no navegador do sistema. */
  readonly aoBaixarLiveStudio: () => void;
}): JSX.Element {
  /*
   * Celular e computador são caminhos IGUAIS, escolhidos por abas — não um
   * caminho principal com o outro de rodapé. Quem transmite do PC (LIVE
   * Studio) é justamente o perfil que mais usa este app, e a primeira versão
   * desta tela o tratava como exceção. Celular abre primeiro por ser o comum.
   */
  const [meio, setMeio] = useState<'celular' | 'computador'>('celular');
  const passos =
    meio === 'celular'
      ? [
          'Pegue o celular e abra o TikTok.',
          'Toque no ＋ (criar) e deslize até LIVE.',
          'Dê um título e toque em "Iniciar transmissão".',
        ]
      : [
          'Instale o TikTok LIVE Studio (botão abaixo) — é o programa oficial do TikTok para transmitir do computador.',
          'Entre nele com a MESMA conta logada aqui do lado.',
          'Escolha câmera ou tela, dê um título e clique em "Go LIVE".',
        ];
  return (
    <Box
      sx={{
        p: 2.25,
        borderRadius: 3.5,
        bgcolor: cores.superficieAlta,
        border: '1px solid',
        borderColor: alpha(cores.ciano, 0.35),
      }}
    >
      <Stack spacing={1.5}>
        <Typography variant="subtitle1" fontWeight={800}>
          Tudo pronto por aqui — agora é só entrar ao vivo
        </Typography>
        <Stack direction="row" spacing={1}>
          {(
            [
              ['celular', 'Pelo celular'],
              ['computador', 'Pelo computador'],
            ] as const
          ).map(([valor, rotulo]) => (
            <Button
              key={valor}
              size="small"
              variant={meio === valor ? 'contained' : 'outlined'}
              color={meio === valor ? 'primary' : 'inherit'}
              onClick={() => setMeio(valor)}
              sx={{ borderRadius: 999, px: 1.75 }}
            >
              {rotulo}
            </Button>
          ))}
        </Stack>
        <Stack spacing={0.75}>
          {passos.map((texto, i) => (
            <Stack key={texto} direction="row" spacing={1} alignItems="flex-start">
              <Typography
                variant="caption"
                fontWeight={800}
                sx={{
                  width: 20,
                  height: 20,
                  flexShrink: 0,
                  borderRadius: '50%',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  bgcolor: alpha(cores.ciano, 0.15),
                  color: cores.ciano,
                }}
              >
                {i + 1}
              </Typography>
              <Typography variant="body2">{texto}</Typography>
            </Stack>
          ))}
        </Stack>
        {meio === 'computador' ? (
          <>
            <Button
              size="small"
              variant="outlined"
              onClick={aoBaixarLiveStudio}
              sx={{ alignSelf: 'flex-start' }}
            >
              Baixar o TikTok LIVE Studio
            </Button>
            <Typography variant="caption" color="text.secondary">
              Já tem o LIVE Studio instalado? Pule o passo 1 e só entre ao vivo
              por ele. O TikTok costuma pedir 1.000 seguidores para liberar a
              live pelo computador — quem decide é ele.
            </Typography>
          </>
        ) : null}
        <Typography
          variant="body2"
          sx={{ color: cores.ciano, fontWeight: 700 }}
        >
          {conectando
            ? passo
            : 'Estou de olho: assim que a sua live entrar no ar, eu conecto sozinho. Pode deixar esta tela aberta.'}
        </Typography>
        <Button size="small" color="inherit" onClick={aoCancelar} sx={{ alignSelf: 'flex-start' }}>
          Cancelar e voltar
        </Button>
      </Stack>
    </Box>
  );
}

/** Um item do checklist de pré-requisitos: verde resolvido, cinza pendente. */
function ItemDeChecklist({
  ok,
  rotulo,
}: {
  readonly ok: boolean;
  readonly rotulo: string;
}): JSX.Element {
  return (
    <Stack
      direction="row"
      spacing={0.6}
      alignItems="center"
      sx={{
        px: 1.1,
        py: 0.4,
        borderRadius: 999,
        border: '1px solid',
        borderColor: ok ? alpha(cores.sucesso, 0.45) : 'divider',
        bgcolor: ok ? alpha(cores.sucesso, 0.10) : 'transparent',
      }}
    >
      <Typography
        variant="caption"
        fontWeight={800}
        sx={{ color: ok ? cores.sucesso : 'text.secondary', lineHeight: 1 }}
      >
        {ok ? '✓' : '·'}
      </Typography>
      <Typography
        variant="caption"
        sx={{ color: ok ? 'text.primary' : 'text.secondary', lineHeight: 1 }}
      >
        {rotulo}
      </Typography>
    </Stack>
  );
}

/**
 * O cabeçalho comum das telas de fora da live.
 *
 * O logo aparece aqui em cima e grande: fora do cockpit não há pressa nenhuma,
 * e é nesses dois momentos — ativar e conectar — que o vendedor precisa
 * reconhecer de que app é a janela que acabou de abrir na frente dele.
 */
function Moldura({
  titulo,
  subtitulo,
  aoSair,
  children,
}: {
  readonly titulo: string;
  readonly subtitulo: string;
  readonly aoSair: () => void;
  readonly children: React.ReactNode;
}): JSX.Element {
  return (
    <Stack spacing={2.5} sx={{ p: 3, pt: 2, overflowY: 'auto' }}>
      <Stack spacing={0.5}>
        <Typography variant="h5">{titulo}</Typography>
        <Typography variant="body2" color="text.secondary">
          {subtitulo}
        </Typography>
      </Stack>
      {children}
      {/*
        A conta fica na MOLDURA, e não no corpo da tela, porque assim ela existe
        em TODOS os estados desta tela — inclusive nos dois em que ela mais
        importa: "não consegui falar com o PikPok" e "você ainda não tem uma
        base pronta". São exatamente os estados de quem entrou na conta errada,
        e prender o logout atrás do caminho feliz deixaria essa pessoa sem saída
        nenhuma dentro do app.
      */}
      <BlocoDaConta variante="compacto" aoSair={aoSair} />
    </Stack>
  );
}
