import AddRoundedIcon from '@mui/icons-material/AddRounded';
import DeleteOutlineRoundedIcon from '@mui/icons-material/DeleteOutlineRounded';
import HeadsetMicRoundedIcon from '@mui/icons-material/HeadsetMicRounded';
import UploadFileRoundedIcon from '@mui/icons-material/UploadFileRounded';
import {
  Alert,
  Box,
  Button,
  Card,
  CardActionArea,
  CardContent,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Grid,
  IconButton,
  LinearProgress,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { BrandLoader } from '@/components/ui/BrandLoader';
import { CREDITS_CHANGED_EVENT } from '@/services/api';
import { billingService } from '@/services/billing.service';
import {
  LIVE_MIN_MINUTES,
  LiveSession,
  MAX_UPLOAD_BYTES,
  PRECO_PADRAO,
  TRANSCRIBE_BLOCK_MINUTES,
  TRANSCRIBE_MAX_MINUTES,
  estimarCreditos,
  lerDuracaoLocal,
  liveService,
} from '@/services/live.service';
import { STATUS_UI, StatusChip, estaProcessando, mensagemDeErro } from './status';
import { CardDoApp } from './CardDoApp';
import { HistoricoDeLives } from './HistoricoDeLives';

/** De quanto em quanto tempo reconsultamos enquanto há live processando. */
const POLL_MS = 8000;

function duracaoLegivel(segundos: number | null): string | null {
  if (!segundos || segundos <= 0) return null;
  const h = Math.floor(segundos / 3600);
  const m = Math.round((segundos % 3600) / 60);
  return h > 0 ? `${h}h${String(m).padStart(2, '0')}` : `${m} min`;
}

function tamanhoLegivel(bytes: number): string {
  const mb = bytes / 1024 / 1024;
  return mb >= 1024 ? `${(mb / 1024).toFixed(2)} GB` : `${mb.toFixed(0)} MB`;
}

/**
 * Diálogo do envio.
 *
 * Ele existe para uma coisa só: nenhum crédito sai da carteira sem o vendedor
 * ter visto o número antes. A conta depende da duração da gravação, então o
 * arquivo é lido no navegador (metadados apenas) assim que é escolhido, e o
 * botão de confirmar só aparece com o custo estampado ao lado.
 */
function NovaBaseDialog({
  aberto,
  onFechar,
  onPronta,
}: {
  aberto: boolean;
  onFechar: () => void;
  onPronta: (sessionId: string) => void;
}) {
  const navigate = useNavigate();
  const [titulo, setTitulo] = useState('');
  const [arquivo, setArquivo] = useState<File | null>(null);
  const [duracao, setDuracao] = useState<number | null>(null);
  const [lendo, setLendo] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [progresso, setProgresso] = useState(0);
  const [erro, setErro] = useState<string | null>(null);
  const [precos, setPrecos] = useState<{ transcribe: number; live_extract: number }>(
    PRECO_PADRAO,
  );
  /*
   * O saldo. `null` enquanto a carteira não respondeu ou falhou — e nesse caso
   * a tela NÃO bloqueia: quem recusa de verdade é o backend, e travar o botão
   * porque uma consulta de leitura caiu impediria de enviar quem tem saldo de
   * sobra. Sem número, o comportamento volta a ser o de antes.
   */
  const [saldo, setSaldo] = useState<number | null>(null);

  useEffect(() => {
    if (!aberto) return;
    // A tabela de preços vem da carteira: fixar o número aqui faria a tela
    // avisar um valor e o backend cobrar outro no dia em que o preço mudar.
    billingService
      .wallet()
      .then((w) => {
        setPrecos({
          transcribe: w.prices?.transcribe?.credits ?? PRECO_PADRAO.transcribe,
          live_extract: w.prices?.live_extract?.credits ?? PRECO_PADRAO.live_extract,
        });
        // Conta interna não tem saldo a conferir: `null` desliga a trava, do
        // mesmo jeito que uma carteira que não respondeu. Sem isto ela seria
        // barrada AQUI, na porta, enquanto o backend a deixaria passar lá
        // dentro — o pior tipo de bug para diagnosticar.
        setSaldo(w.unlimited ? null : (w.credits ?? null));
      })
      .catch(() => {
        setPrecos(PRECO_PADRAO);
        setSaldo(null);
      });
  }, [aberto]);

  function limpar() {
    setTitulo('');
    setArquivo(null);
    setDuracao(null);
    setProgresso(0);
    setErro(null);
    setEnviando(false);
  }

  async function escolher(file: File | undefined) {
    if (!file) return;
    setErro(null);
    /*
     * Áudio puro é recusado aqui na frente, e não depois de subir gigabytes: o
     * `accept` do seletor já filtra, mas ele é dica e não trava — arrastar um
     * MP3 ou escolher "todos os arquivos" passa por cima dele em qualquer
     * navegador. O backend recusa de novo, pelo ffmpeg; esta é a recusa que
     * chega ANTES do upload.
     */
    if (file.type.startsWith('audio/')) {
      setErro(
        'Este arquivo é só áudio. Envie o vídeo da live — é da gravação da transmissão, com imagem, que eu monto a base.',
      );
      return;
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      setErro(
        `A gravação tem ${tamanhoLegivel(file.size)} e o limite por envio é de ${tamanhoLegivel(MAX_UPLOAD_BYTES)}. Corte a live em partes e envie uma de cada vez.`,
      );
      return;
    }
    setArquivo(file);
    if (!titulo.trim()) setTitulo(file.name.replace(/\.[^.]+$/, ''));
    setLendo(true);
    const segundos = await lerDuracaoLocal(file);
    setDuracao(segundos);
    setLendo(false);
  }

  const orcamento = estimarCreditos(duracao, precos);
  const longaDemais = duracao != null && duracao > TRANSCRIBE_MAX_MINUTES * 60;
  /*
   * O piso, medido aqui no navegador pelo mesmo motivo do teto: o arquivo ainda
   * não subiu. Barrar só depois, no backend, faria o vendedor esperar o upload
   * inteiro de uma gravação que já se sabia curta demais.
   */
  const curtaDemais = duracao != null && duracao < LIVE_MIN_MINUTES * 60;
  /*
   * Saldo insuficiente vira recusa aqui, na frente, e não uma sessão em 'erro'
   * lá atrás. Comparar contra o orçamento estimado — e não contra o piso do
   * backend — é o ponto: uma live de 3 horas com 8 créditos na conta passa na
   * trava do servidor e quebra no meio do pipeline, depois do upload inteiro.
   * O navegador é o único lado que conhece a duração antes de o arquivo subir.
   */
  const semSaldo = saldo !== null && arquivo !== null && saldo < orcamento.creditos;

  async function enviar() {
    if (!arquivo || !titulo.trim()) return;
    setEnviando(true);
    setErro(null);
    setProgresso(0);
    try {
      const sessao = await liveService.createSession(titulo.trim());
      await liveService.upload(sessao.id, arquivo, setProgresso);
      limpar();
      onPronta(sessao.id);
    } catch (error) {
      setErro(mensagemDeErro(error));
      setEnviando(false);
    }
  }

  return (
    <Dialog
      open={aberto}
      onClose={enviando ? undefined : onFechar}
      fullWidth
      maxWidth="sm"
    >
      <DialogTitle sx={{ fontWeight: 800 }}>Nova base de conhecimento</DialogTitle>
      <DialogContent dividers>
        <Stack spacing={2.5}>
          <Typography variant="body2" color="text.secondary">
            Suba a gravação de uma live que você já fez. A gente ouve tudo e monta
            a lista dos seus produtos, preços, variações, frete e as perguntas que
            o chat mais faz — pronta para você revisar.
          </Typography>

          <TextField
            label="Como você quer chamar esta live"
            placeholder="Live de terça — kits de skincare"
            value={titulo}
            onChange={(e) => setTitulo(e.target.value.slice(0, 200))}
            disabled={enviando}
            fullWidth
          />

          <Box>
            <Button
              component="label"
              variant="outlined"
              startIcon={<UploadFileRoundedIcon />}
              disabled={enviando}
            >
              {arquivo ? 'Trocar gravação' : 'Escolher a gravação'}
              <input
                hidden
                type="file"
                accept="video/*"
                onChange={(e) => escolher(e.target.files?.[0])}
              />
            </Button>
            <Typography variant="caption" color="text.secondary" display="block" mt={1}>
              O vídeo da live (mp4, mov, mkv ou webm), de {LIVE_MIN_MINUTES} minutos a{' '}
              {TRANSCRIBE_MAX_MINUTES / 60} horas e até {tamanhoLegivel(MAX_UPLOAD_BYTES)}{' '}
              por envio. Arquivo só de áudio não serve.
            </Typography>
            {arquivo && (
              <Typography variant="body2" mt={1} fontWeight={700}>
                {arquivo.name} · {tamanhoLegivel(arquivo.size)}
                {duracaoLegivel(duracao) ? ` · ${duracaoLegivel(duracao)}` : ''}
              </Typography>
            )}
          </Box>

          {longaDemais && (
            <Alert severity="warning">
              Esta gravação passa de {TRANSCRIBE_MAX_MINUTES / 60} horas. Corte em
              partes e envie uma de cada vez, senão o processamento falha depois de
              começar.
            </Alert>
          )}

          {curtaDemais && (
            <Alert severity="warning">
              Esta gravação tem menos de {LIVE_MIN_MINUTES} minutos. É da fala da
              live que eu tiro produtos, preços e objeções — num trecho curto não
              há material suficiente, e a base sairia vazia. Envie a live inteira.
            </Alert>
          )}

          {semSaldo && !lendo && !longaDemais && !curtaDemais && (
            <Alert
              severity="warning"
              action={
                <Button
                  size="small"
                  color="inherit"
                  onClick={() => navigate('/planos')}
                >
                  Comprar créditos
                </Button>
              }
            >
              <Typography fontWeight={800} mb={0.5}>
                Você tem {saldo}{' '}
                {saldo === 1 ? 'crédito' : 'créditos'} e este envio custa{' '}
                {orcamento.creditos}
              </Typography>
              <Typography variant="body2">
                Recarregue antes de enviar. Assim a gravação não sobe à toa para
                parar no meio do processamento.
              </Typography>
            </Alert>
          )}

          {arquivo && !lendo && !longaDemais && !curtaDemais && !semSaldo && (
            <Alert severity="info" icon={false}>
              <Typography fontWeight={800} mb={0.5}>
                {orcamento.exato ? 'Vai consumir' : 'Vai consumir a partir de'}{' '}
                {orcamento.creditos} créditos
              </Typography>
              {/*
                A conta aparece SOMADA, com o subtotal da transcrição escrito.
                A versão anterior dizia "6 créditos por cada 10 minutos (2
                blocos) mais 17" e estampava 29: os três números estavam certos
                e mesmo assim a frase não fechava, porque o 12 — o único que
                explica o salto — nunca era dito. Preço que parece errado é
                tratado como erro, e aí o vendedor não envia.
              */}
              <Typography variant="body2" component="div">
                <Box component="ul" sx={{ m: 0, pl: 2.5 }}>
                  <li>
                    Transcrição: {orcamento.blocos} ×{' '}
                    {precos.transcribe} = <strong>
                      {precos.transcribe * orcamento.blocos}
                    </strong>{' '}
                    créditos ({TRANSCRIBE_BLOCK_MINUTES} minutos por bloco, sempre
                    arredondando o bloco começado para cima)
                  </li>
                  <li>
                    Montagem da base: <strong>{precos.live_extract}</strong>{' '}
                    créditos, uma vez por live
                  </li>
                </Box>
                {!orcamento.exato &&
                  'Não conseguimos ler a duração deste arquivo aqui no navegador — o valor final sai da duração real e pode ser maior.'}
              </Typography>
            </Alert>
          )}

          {enviando && (
            <Box>
              <LinearProgress
                variant={progresso >= 100 ? 'indeterminate' : 'determinate'}
                value={progresso}
              />
              <Typography variant="caption" color="text.secondary">
                {progresso >= 100
                  ? 'Gravação enviada, começando o processamento...'
                  : `Enviando a gravação... ${progresso}%`}
              </Typography>
            </Box>
          )}

          {erro && <Alert severity="error">{erro}</Alert>}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onFechar} disabled={enviando}>
          Cancelar
        </Button>
        <Button
          variant="contained"
          onClick={enviar}
          disabled={
            !arquivo ||
            !titulo.trim() ||
            lendo ||
            enviando ||
            longaDemais ||
            curtaDemais ||
            semSaldo
          }
        >
          {curtaDemais
            ? `Mínimo de ${LIVE_MIN_MINUTES} minutos`
            : semSaldo
            ? 'Créditos insuficientes'
            : arquivo && !lendo && !longaDemais
              ? `Enviar e gastar ${orcamento.creditos} créditos`
              : 'Enviar gravação'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

export function LivePage() {
  const navigate = useNavigate();
  const [sessoes, setSessoes] = useState<LiveSession[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [dialogo, setDialogo] = useState(false);
  const processandoAntes = useRef(false);

  const carregar = useCallback(async () => {
    try {
      const lista = await liveService.listSessions();
      setSessoes(lista);
      setErro(null);
      return lista;
    } catch (error) {
      setErro(mensagemDeErro(error));
      return null;
    }
  }, []);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  /*
   * Polling com prazo de validade.
   *
   * O efeito depende da própria lista, então ele se re-arma a cada resposta e
   * simplesmente NÃO agenda o próximo ciclo quando nenhuma live está mais
   * processando — em vez de deixar um `setInterval` batendo na API para sempre
   * numa aba esquecida aberta. `setTimeout` e não `setInterval` de propósito:
   * o relógio só recomeça depois que a resposta chegou, então uma consulta
   * lenta nunca empilha a próxima em cima dela.
   */
  useEffect(() => {
    if (!sessoes) return;
    const trabalhando = sessoes.some((s) => estaProcessando(s.status));

    // O débito acontece em background, no fim do pipeline. Quando a última
    // live sai do processamento, o saldo no cabeçalho está velho.
    if (processandoAntes.current && !trabalhando) {
      window.dispatchEvent(new Event(CREDITS_CHANGED_EVENT));
    }
    processandoAntes.current = trabalhando;

    if (!trabalhando) return;
    const timer = window.setTimeout(() => void carregar(), POLL_MS);
    return () => window.clearTimeout(timer);
  }, [sessoes, carregar]);

  async function apagar(sessao: LiveSession) {
    if (
      !window.confirm(
        `Apagar "${sessao.title}"? A base de conhecimento dela vai junto e não dá para desfazer.`,
      )
    ) {
      return;
    }
    try {
      await liveService.deleteSession(sessao.id);
      await carregar();
    } catch (error) {
      setErro(mensagemDeErro(error));
    }
  }

  if (!sessoes) return <BrandLoader label="Carregando suas lives..." />;

  return (
    <>
      {/*
       * O cabeçalho carrega o logo e o gradiente da marca porque esta é a porta
       * de um produto que continua FORA do navegador: daqui a pessoa vai baixar
       * um aplicativo e abri-lo no meio de uma transmissão. Quando ela vir a
       * janela do app, tem que reconhecer que é a mesma coisa que viu aqui.
       */}
      <Box
        sx={{
          position: 'relative',
          overflow: 'hidden',
          borderRadius: 4,
          p: { xs: 2.5, md: 3 },
          mb: 3,
          border: '1px solid',
          borderColor: 'divider',
          bgcolor: 'background.paper',
          backgroundImage:
            'radial-gradient(70% 130% at 100% 0%, rgba(254,44,85,0.10) 0%, transparent 60%),' +
            'radial-gradient(50% 100% at 0% 100%, rgba(0,194,187,0.07) 0%, transparent 60%)',
        }}
      >
        <Stack
          direction={{ xs: 'column', sm: 'row' }}
          alignItems={{ sm: 'center' }}
          justifyContent="space-between"
          spacing={2}
        >
          <Stack direction="row" spacing={1.75} alignItems="center" sx={{ minWidth: 0 }}>
            <Box
              component="img"
              src="/icon-192.png"
              alt=""
              sx={{
                width: 48,
                height: 48,
                borderRadius: 2.5,
                flexShrink: 0,
                boxShadow: '0 6px 22px rgba(254,44,85,0.22)',
              }}
            />
            <Box sx={{ minWidth: 0 }}>
              <Typography variant="h5" sx={{ lineHeight: 1.2 }}>
                Copiloto de Live
              </Typography>
              <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                Suba uma live que você já fez e transforme o que você falou ao
                vivo numa base de conhecimento dos seus produtos.
              </Typography>
            </Box>
          </Stack>
          <Button
            variant="contained"
            startIcon={<AddRoundedIcon />}
            onClick={() => setDialogo(true)}
            sx={{ flexShrink: 0, alignSelf: { xs: 'flex-start', sm: 'center' } }}
          >
            Nova base
          </Button>
        </Stack>
      </Box>

      {erro && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {erro}
        </Alert>
      )}

      {/*
       * O app vem ANTES da lista, e não no fim da página, porque sem ele metade
       * do produto não existe: a base montada aqui só vira resposta no chat
       * quando o aplicativo está rodando na live. Quem chega nesta tela precisa
       * descobrir isso agora, não depois de procurar.
       */}
      <CardDoApp paraQuem="lista" />

      {/*
       * Some sozinho para quem nunca transmitiu — ver `HistoricoDeLives`. Fica
       * acima das bases porque, para quem já usa o produto, "como foi a última
       * live" é a pergunta que traz a pessoa a esta tela.
       */}
      <HistoricoDeLives />

      {sessoes.length === 0 ? (
        <Card
          sx={{
            textAlign: 'center',
            py: { xs: 5, md: 8 },
            px: 3,
            borderStyle: 'dashed',
            // Vazio não é erro: a moldura tracejada diz "aqui vai entrar
            // alguma coisa" em vez de parecer um card que falhou ao carregar.
            bgcolor: 'transparent',
            '&:hover': { bgcolor: 'transparent' },
          }}
        >
          <Box
            sx={{
              width: 72,
              height: 72,
              mx: 'auto',
              mb: 2,
              borderRadius: '50%',
              display: 'grid',
              placeItems: 'center',
              bgcolor: 'rgba(254,44,85,0.08)',
            }}
          >
            <HeadsetMicRoundedIcon sx={{ fontSize: 34, color: '#fe2c55' }} />
          </Box>
          <Typography variant="h6" fontWeight={800} mb={1}>
            Sua live sabe tudo sobre seus produtos. Falta só anotar.
          </Typography>
          <Typography color="text.secondary" sx={{ maxWidth: 560, mx: 'auto', mb: 3 }}>
            Você já respondeu mil vezes preço, tamanho, cor, frete e "chega
            quando?" ao vivo. Suba a gravação de uma live e a gente ouve tudo,
            separa cada produto com preço, variações, frete e promoção, e junta as
            perguntas e objeções que o chat mais repete. Depois você revisa e
            corrige o que quiser — a base fica sua.
          </Typography>
          <Button
            variant="contained"
            size="large"
            startIcon={<UploadFileRoundedIcon />}
            onClick={() => setDialogo(true)}
          >
            Enviar minha primeira live
          </Button>
        </Card>
      ) : (
        <Grid container spacing={2}>
          {sessoes.map((sessao) => {
            const ui = STATUS_UI[sessao.status];
            return (
              <Grid item xs={12} md={6} key={sessao.id}>
                <Card
                  sx={{
                    height: '100%',
                    display: 'flex',
                    flexDirection: 'column',
                    position: 'relative',
                    overflow: 'hidden',
                    // Uma base pronta é a que o vendedor veio buscar — ela se
                    // distingue por um fio verde na borda de cima, legível de
                    // relance numa grade de oito cards. As em processamento
                    // ficam neutras: não há nada a fazer com elas ainda.
                    '&::before':
                      sessao.status === 'pronta'
                        ? {
                            content: '""',
                            position: 'absolute',
                            top: 0,
                            left: 0,
                            right: 0,
                            height: 2,
                            bgcolor: 'success.main',
                          }
                        : undefined,
                  }}
                >
                  <CardActionArea
                    onClick={() => navigate(`/copiloto/${sessao.id}`)}
                    sx={{ flex: 1, alignItems: 'flex-start' }}
                  >
                    <CardContent>
                      <Stack
                        direction="row"
                        alignItems="flex-start"
                        justifyContent="space-between"
                        spacing={1}
                      >
                        <Typography fontWeight={800} sx={{ flexGrow: 1, lineHeight: 1.35 }}>
                          {sessao.title}
                        </Typography>
                        <StatusChip status={sessao.status} />
                      </Stack>

                      <Typography
                        variant="body2"
                        color="text.secondary"
                        mt={1}
                        sx={{ lineHeight: 1.55 }}
                      >
                        {sessao.status === 'erro'
                          ? (sessao.errorMessage ?? ui.dica)
                          : ui.dica}
                      </Typography>

                      <Stack direction="row" spacing={1} mt={1.5} flexWrap="wrap" useFlexGap>
                        {duracaoLegivel(sessao.durationSeconds) && (
                          <Chip
                            size="small"
                            variant="outlined"
                            label={`Live de ${duracaoLegivel(sessao.durationSeconds)}`}
                          />
                        )}
                        {sessao.creditsSpent > 0 && (
                          <Chip
                            size="small"
                            variant="outlined"
                            label={`${sessao.creditsSpent} créditos usados`}
                          />
                        )}
                        <Chip
                          size="small"
                          variant="outlined"
                          label={new Date(sessao.createdAt).toLocaleDateString('pt-BR')}
                        />
                      </Stack>
                    </CardContent>
                  </CardActionArea>
                  <Box display="flex" justifyContent="flex-end" px={1.5} pb={1}>
                    <Tooltip title="Apagar esta live">
                      <span>
                        <IconButton
                          size="small"
                          aria-label={`Apagar ${sessao.title}`}
                          onClick={() => void apagar(sessao)}
                          disabled={estaProcessando(sessao.status)}
                        >
                          <DeleteOutlineRoundedIcon fontSize="small" />
                        </IconButton>
                      </span>
                    </Tooltip>
                  </Box>
                </Card>
              </Grid>
            );
          })}
        </Grid>
      )}

      <NovaBaseDialog
        aberto={dialogo}
        onFechar={() => setDialogo(false)}
        onPronta={(id) => {
          setDialogo(false);
          navigate(`/copiloto/${id}`);
        }}
      />
    </>
  );
}
