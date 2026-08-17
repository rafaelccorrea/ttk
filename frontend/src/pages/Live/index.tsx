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
  LiveSession,
  MAX_UPLOAD_BYTES,
  PRECO_PADRAO,
  TRANSCRIBE_MAX_MINUTES,
  estimarCreditos,
  lerDuracaoLocal,
  liveService,
} from '@/services/live.service';
import { STATUS_UI, StatusChip, estaProcessando, mensagemDeErro } from './status';

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

  useEffect(() => {
    if (!aberto) return;
    // A tabela de preços vem da carteira: fixar o número aqui faria a tela
    // avisar um valor e o backend cobrar outro no dia em que o preço mudar.
    billingService
      .wallet()
      .then((w) =>
        setPrecos({
          transcribe: w.prices?.transcribe?.credits ?? PRECO_PADRAO.transcribe,
          live_extract: w.prices?.live_extract?.credits ?? PRECO_PADRAO.live_extract,
        }),
      )
      .catch(() => setPrecos(PRECO_PADRAO));
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
                accept="video/*,audio/*"
                onChange={(e) => escolher(e.target.files?.[0])}
              />
            </Button>
            <Typography variant="caption" color="text.secondary" display="block" mt={1}>
              Vídeo ou áudio (mp4, mov, mkv, m4a, mp3...), até{' '}
              {tamanhoLegivel(MAX_UPLOAD_BYTES)} e {TRANSCRIBE_MAX_MINUTES / 60} horas
              por envio.
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

          {arquivo && !lendo && !longaDemais && (
            <Alert severity="info" icon={false}>
              <Typography fontWeight={800} mb={0.5}>
                {orcamento.exato ? 'Vai consumir' : 'Vai consumir a partir de'}{' '}
                {orcamento.creditos} créditos
              </Typography>
              <Typography variant="body2">
                {precos.transcribe} créditos por cada 10 minutos de gravação (
                {orcamento.blocos}{' '}
                {orcamento.blocos === 1 ? 'bloco' : 'blocos'}) mais{' '}
                {precos.live_extract} créditos para montar a base.
                {!orcamento.exato &&
                  ' Não conseguimos ler a duração deste arquivo aqui no navegador — o valor final sai da duração real e pode ser maior.'}
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
          disabled={!arquivo || !titulo.trim() || lendo || enviando || longaDemais}
        >
          {arquivo && !lendo && !longaDemais
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
      <Stack
        direction={{ xs: 'column', sm: 'row' }}
        alignItems={{ sm: 'center' }}
        justifyContent="space-between"
        spacing={1.5}
        mb={0.5}
      >
        <Typography variant="h5">Copiloto de Live</Typography>
        <Button
          variant="contained"
          startIcon={<AddRoundedIcon />}
          onClick={() => setDialogo(true)}
        >
          Nova base
        </Button>
      </Stack>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
        Suba uma live que você já fez e transforme o que você falou ao vivo numa
        base de conhecimento organizada dos seus produtos.
      </Typography>

      {erro && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {erro}
        </Alert>
      )}

      {sessoes.length === 0 ? (
        <Card sx={{ textAlign: 'center', py: { xs: 5, md: 8 }, px: 3 }}>
          <HeadsetMicRoundedIcon sx={{ fontSize: 48, color: '#fe2c55', mb: 1.5 }} />
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
                <Card sx={{ height: '100%' }}>
                  <CardActionArea onClick={() => navigate(`/copiloto/${sessao.id}`)}>
                    <CardContent>
                      <Stack
                        direction="row"
                        alignItems="flex-start"
                        justifyContent="space-between"
                        spacing={1}
                      >
                        <Typography fontWeight={800} sx={{ flexGrow: 1 }}>
                          {sessao.title}
                        </Typography>
                        <StatusChip status={sessao.status} />
                      </Stack>

                      <Typography variant="body2" color="text.secondary" mt={1}>
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
