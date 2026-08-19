import UploadFileRoundedIcon from '@mui/icons-material/UploadFileRounded';
import {
  Alert,
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  LinearProgress,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { billingService } from '@/services/billing.service';
import {
  LIVE_MIN_MINUTES,
  MAX_UPLOAD_BYTES,
  PRECO_PADRAO,
  TRANSCRIBE_BLOCK_MINUTES,
  TRANSCRIBE_MAX_MINUTES,
  estimarCreditos,
  lerDuracaoLocal,
  liveService,
} from '@/services/live.service';
import { useConfirmarGasto } from '@/hooks/useConfirmarGasto';
import { mensagemDeErro } from './status';

export function duracaoLegivel(segundos: number | null): string | null {
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
 * Diálogo do envio da gravação.
 *
 * Ele existe para uma coisa só: nenhum crédito sai da carteira sem o vendedor
 * ter visto o número antes. A conta depende da duração da gravação, então o
 * arquivo é lido no navegador (metadados apenas) assim que é escolhido, e o
 * botão de confirmar só aparece com o custo estampado ao lado.
 *
 * `reenvioDe` é o segundo uso, nascido de um beco sem saída: a live que
 * terminava em erro mostrava o alerta e NENHUM caminho de volta — o vendedor
 * tinha que adivinhar que era para voltar à lista e criar uma live nova do
 * zero, perdendo título e contexto. Com a sessão informada, o diálogo pula a
 * criação e envia a gravação para ela mesma, que é o que o backend já aceitava.
 */
export function EnvioDialog({
  aberto,
  onFechar,
  onPronta,
  reenvioDe,
}: {
  aberto: boolean;
  onFechar: () => void;
  onPronta: (sessionId: string) => void;
  /** Sessão existente que vai receber a gravação (reenvio após erro). */
  reenvioDe?: { id: string; title: string };
}) {
  const navigate = useNavigate();
  const { confirmar, dialogo } = useConfirmarGasto();
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
    if (!reenvioDe && !titulo.trim()) setTitulo(file.name.replace(/\.[^.]+$/, ''));
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

  const tituloValido = reenvioDe ? true : Boolean(titulo.trim());

  async function enviar() {
    if (!arquivo || !tituloValido) return;
    /*
     * Um envio cobra DUAS ações: a transcrição, por bloco de 10 minutos, e a
     * montagem da base, uma vez. O diálogo usa o total já calculado na tela
     * (`orcamento`) em vez do preço de uma delas — confirmar só metade da conta
     * seria pior do que não confirmar.
     */
    const autorizado = await confirmar({
      acao: 'live_extract',
      titulo: 'Processar gravação da live',
      custoTotal: orcamento.creditos,
      detalhe: `${orcamento.blocos} ${
        orcamento.blocos === 1 ? 'bloco' : 'blocos'
      } de transcrição mais a montagem da base de conhecimento.`,
    });
    if (!autorizado) return;
    setEnviando(true);
    setErro(null);
    setProgresso(0);
    try {
      const sessionId = reenvioDe
        ? reenvioDe.id
        : (await liveService.createSession(titulo.trim())).id;
      await liveService.upload(sessionId, arquivo, setProgresso);
      limpar();
      onPronta(sessionId);
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
      <DialogTitle sx={{ fontWeight: 800 }}>
        {reenvioDe ? 'Enviar a gravação de novo' : 'Nova base de conhecimento'}
      </DialogTitle>
      <DialogContent dividers>
        <Stack spacing={2.5}>
          <Typography variant="body2" color="text.secondary">
            {reenvioDe
              ? `A gravação vai para esta mesma live ("${reenvioDe.title}") e o processamento recomeça do zero — nada da tentativa anterior é cobrado de novo.`
              : 'Suba a gravação de uma live que você já fez. A gente ouve tudo e monta a lista dos seus produtos, preços, variações, frete e as perguntas que o chat mais faz — pronta para você revisar.'}
          </Typography>

          {!reenvioDe && (
            <TextField
              label="Como você quer chamar esta live"
              placeholder="Live de terça — kits de skincare"
              value={titulo}
              onChange={(e) => setTitulo(e.target.value.slice(0, 200))}
              disabled={enviando}
              fullWidth
            />
          )}

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
            !tituloValido ||
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
      {dialogo}
    </Dialog>
  );
}
