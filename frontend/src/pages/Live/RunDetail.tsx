import ArrowBackRoundedIcon from '@mui/icons-material/ArrowBackRounded';
import CardGiftcardRoundedIcon from '@mui/icons-material/CardGiftcardRounded';
import FavoriteRoundedIcon from '@mui/icons-material/FavoriteRounded';
import GroupsRoundedIcon from '@mui/icons-material/GroupsRounded';
import PersonAddAlt1RoundedIcon from '@mui/icons-material/PersonAddAlt1Rounded';
import QuestionAnswerRoundedIcon from '@mui/icons-material/QuestionAnswerRounded';
import ShareRoundedIcon from '@mui/icons-material/ShareRounded';
import {
  Alert,
  Box,
  Card,
  CardContent,
  Chip,
  IconButton,
  Stack,
  Tooltip,
  Typography,
  useTheme,
} from '@mui/material';
import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { BrandLoader } from '@/components/ui/BrandLoader';
import {
  LiveRunDetail,
  LiveRunQa,
  liveService,
} from '@/services/live.service';
import { mensagemDeErro } from './status';
import { aproveitamento, latencia, quando } from './HistoricoDeLives';

/**
 * A página de UMA transmissão: o que aconteceu, minuto a minuto.
 *
 * Tudo aqui já estava no banco antes desta tela existir — perguntas, respostas,
 * confiança, entrega — e morria sem nunca ser visto: o vendedor via os cards do
 * painel durante a live e depois só o agregado do histórico. Esta página é o
 * replay: a curva de audiência diz QUANDO a live pegou fogo, e a lista de
 * perguntas diz DO QUE o chat estava falando naquele momento.
 */
export function LiveRunPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [run, setRun] = useState<LiveRunDetail | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    liveService
      .getRun(id)
      .then(setRun)
      .catch((e) => setErro(mensagemDeErro(e)));
  }, [id]);

  if (erro) return <Alert severity="error">{erro}</Alert>;
  if (!run) return <BrandLoader label="Carregando a transmissão..." />;

  const escaladasSemResposta = run.qa.filter((q) => q.answer === null).length;

  return (
    <>
      <Stack direction="row" spacing={1.5} alignItems="center" mb={2.5}>
        <IconButton onClick={() => navigate('/copiloto')} aria-label="Voltar">
          <ArrowBackRoundedIcon />
        </IconButton>
        <Box sx={{ minWidth: 0 }}>
          <Stack direction="row" spacing={1} alignItems="center">
            <Typography variant="h5" sx={{ lineHeight: 1.2 }}>
              Live de {quando(run.startedAt)}
            </Typography>
            {run.status === 'erro' && (
              <Chip size="small" color="warning" label="interrompida" />
            )}
            {run.mode === 'auto' && (
              <Chip size="small" variant="outlined" label="automático" />
            )}
          </Stack>
          <Typography variant="body2" color="text.secondary">
            {run.tiktokUsername ? `@${run.tiktokUsername.replace(/^@/, '')} · ` : ''}
            {run.minutesCharged} min de copiloto
          </Typography>
        </Box>
      </Stack>

      {/* O resumo em números. A ordem conta a história: quem assistiu, o que
          perguntou, o que o copiloto fez com isso. */}
      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: {
            xs: 'repeat(2, 1fr)',
            sm: 'repeat(3, 1fr)',
            md: 'repeat(6, 1fr)',
          },
          gap: 1.5,
          mb: 3,
        }}
      >
        <Indicador
          icone={<GroupsRoundedIcon />}
          rotulo="Pico de público"
          valor={run.peakViewers > 0 ? formatar(run.peakViewers) : '—'}
          dica="O maior número de pessoas assistindo ao mesmo tempo."
        />
        <Indicador
          icone={<FavoriteRoundedIcon />}
          rotulo="Curtidas"
          valor={run.totalLikes > 0 ? formatar(run.totalLikes) : '—'}
        />
        <Indicador
          icone={<CardGiftcardRoundedIcon />}
          rotulo="Presentes"
          valor={run.totalGifts > 0 ? formatar(run.totalGifts) : '—'}
          dica={
            run.totalGiftDiamonds > 0
              ? `${formatar(run.totalGiftDiamonds)} diamantes`
              : undefined
          }
        />
        <Indicador
          icone={<PersonAddAlt1RoundedIcon />}
          rotulo="Novos seguidores"
          valor={run.totalFollows > 0 ? formatar(run.totalFollows) : '—'}
        />
        <Indicador
          icone={<ShareRoundedIcon />}
          rotulo="Compartilhada"
          valor={run.totalShares > 0 ? formatar(run.totalShares) : '—'}
        />
        <Indicador
          icone={<QuestionAnswerRoundedIcon />}
          rotulo="Aproveitamento"
          valor={aproveitamento(run.usageRate)}
          dica={`${run.repliesUsed} de ${run.repliesGenerated} respostas usadas · resposta em ${latencia(run.latencyP50Ms)}`}
        />
      </Box>

      <GraficoDeAudiencia run={run} />

      <Card>
        <CardContent>
          <Stack direction="row" spacing={1} alignItems="center" mb={0.5}>
            <QuestionAnswerRoundedIcon
              sx={{ color: 'text.secondary', fontSize: 20 }}
            />
            <Typography fontWeight={800}>
              Perguntas e respostas da live
            </Typography>
          </Stack>
          <Typography variant="body2" color="text.secondary" mb={2}>
            {run.qa.length === 0
              ? 'Nenhuma pergunta foi registrada nesta transmissão.'
              : escaladasSemResposta > 0
                ? `${run.qa.length} perguntas — ${escaladasSemResposta} ficaram com você. As escaladas são os buracos da base: responda uma vez na base e a próxima live já sai certa.`
                : `${run.qa.length} perguntas respondidas pelo copiloto.`}
          </Typography>

          <Stack spacing={1.5}>
            {run.qa.map((item) => (
              <LinhaDeQa key={item.chatMessageId} item={item} />
            ))}
          </Stack>
        </CardContent>
      </Card>
    </>
  );
}

function Indicador({
  icone,
  rotulo,
  valor,
  dica,
}: {
  icone: React.ReactNode;
  rotulo: string;
  valor: string;
  dica?: string;
}) {
  const conteudo = (
    <Card sx={{ height: '100%' }}>
      <CardContent sx={{ p: 1.75, '&:last-child': { pb: 1.75 } }}>
        <Stack direction="row" spacing={0.75} alignItems="center" mb={0.5}>
          <Box
            sx={{
              display: 'grid',
              placeItems: 'center',
              color: 'text.secondary',
              '& svg': { fontSize: 16 },
            }}
          >
            {icone}
          </Box>
          <Typography variant="caption" color="text.secondary" noWrap>
            {rotulo}
          </Typography>
        </Stack>
        <Typography variant="h6" fontWeight={800} sx={{ lineHeight: 1.1 }}>
          {valor}
        </Typography>
      </CardContent>
    </Card>
  );
  return dica ? <Tooltip title={dica}>{conteudo}</Tooltip> : conteudo;
}

/**
 * A curva de público da live, com as curtidas por janela na dica.
 *
 * SVG desenhado à mão em vez de uma lib de gráfico: é UMA série, uma curva, um
 * tooltip — o custo de uma dependência de gráficos não se paga por isso. Um
 * eixo só, sem eixo duplo; a série é nomeada pelo título, então não há legenda.
 */
function GraficoDeAudiencia({ run }: { run: LiveRunDetail }) {
  const theme = useTheme();
  const [foco, setFoco] = useState<number | null>(null);

  const pontos = useMemo(
    () => run.metricas.filter((m) => m.viewerCount !== null),
    [run.metricas],
  );

  if (pontos.length < 2) {
    // Lives de antes da captura de audiência (ou curtas demais) não têm curva —
    // e um gráfico vazio acusaria um problema que não existe.
    return null;
  }

  const LARGURA = 800;
  const ALTURA = 220;
  const M = { top: 16, right: 12, bottom: 24, left: 44 };
  const w = LARGURA - M.left - M.right;
  const h = ALTURA - M.top - M.bottom;

  const t0 = new Date(pontos[0].capturedAt).getTime();
  const t1 = new Date(pontos[pontos.length - 1].capturedAt).getTime();
  const maxY = Math.max(...pontos.map((p) => p.viewerCount ?? 0), 1);

  const x = (iso: string) =>
    M.left + ((new Date(iso).getTime() - t0) / Math.max(t1 - t0, 1)) * w;
  const y = (v: number) => M.top + h - (v / maxY) * h;

  const linha = pontos
    .map((p, i) => `${i === 0 ? 'M' : 'L'}${x(p.capturedAt).toFixed(1)},${y(p.viewerCount ?? 0).toFixed(1)}`)
    .join(' ');
  const area = `${linha} L${x(pontos[pontos.length - 1].capturedAt).toFixed(1)},${M.top + h} L${x(pontos[0].capturedAt).toFixed(1)},${M.top + h} Z`;

  const cor = theme.palette.primary.main;
  const focoPonto = foco !== null ? pontos[foco] : null;

  const aoMover = (e: React.MouseEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const mx = ((e.clientX - rect.left) / rect.width) * LARGURA;
    let melhor = 0;
    let dist = Infinity;
    pontos.forEach((p, i) => {
      const d = Math.abs(x(p.capturedAt) - mx);
      if (d < dist) {
        dist = d;
        melhor = i;
      }
    });
    setFoco(melhor);
  };

  const horaDe = (iso: string) =>
    new Date(iso).toLocaleTimeString('pt-BR', {
      hour: '2-digit',
      minute: '2-digit',
    });

  return (
    <Card sx={{ mb: 3 }}>
      <CardContent>
        <Typography fontWeight={800} mb={0.5}>
          Pessoas assistindo
        </Typography>
        <Typography variant="body2" color="text.secondary" mb={1.5}>
          Passe o mouse para ver cada momento — cruze os picos com as perguntas
          abaixo para saber o que estava no ar quando a live cresceu.
        </Typography>
        <Box sx={{ overflowX: 'auto' }}>
          <Box
            component="svg"
            viewBox={`0 0 ${LARGURA} ${ALTURA}`}
            role="img"
            aria-label="Evolução do número de espectadores durante a live"
            sx={{ width: '100%', minWidth: 480, display: 'block' }}
            onMouseMove={aoMover}
            onMouseLeave={() => setFoco(null)}
          >
            {/* grade recessiva: três linhas bastam para dar escala */}
            {[0, 0.5, 1].map((f) => (
              <g key={f}>
                <line
                  x1={M.left}
                  x2={M.left + w}
                  y1={y(maxY * f)}
                  y2={y(maxY * f)}
                  stroke={theme.palette.divider}
                  strokeWidth={1}
                />
                <text
                  x={M.left - 8}
                  y={y(maxY * f) + 4}
                  textAnchor="end"
                  fontSize={11}
                  fill={theme.palette.text.secondary}
                >
                  {formatar(Math.round(maxY * f))}
                </text>
              </g>
            ))}
            <text
              x={M.left}
              y={ALTURA - 6}
              fontSize={11}
              fill={theme.palette.text.secondary}
            >
              {horaDe(pontos[0].capturedAt)}
            </text>
            <text
              x={M.left + w}
              y={ALTURA - 6}
              textAnchor="end"
              fontSize={11}
              fill={theme.palette.text.secondary}
            >
              {horaDe(pontos[pontos.length - 1].capturedAt)}
            </text>

            <path d={area} fill={cor} opacity={0.12} />
            <path d={linha} fill="none" stroke={cor} strokeWidth={2} />

            {focoPonto && (
              <g>
                <line
                  x1={x(focoPonto.capturedAt)}
                  x2={x(focoPonto.capturedAt)}
                  y1={M.top}
                  y2={M.top + h}
                  stroke={theme.palette.text.secondary}
                  strokeDasharray="3 3"
                  strokeWidth={1}
                />
                <circle
                  cx={x(focoPonto.capturedAt)}
                  cy={y(focoPonto.viewerCount ?? 0)}
                  r={4}
                  fill={cor}
                  stroke={theme.palette.background.paper}
                  strokeWidth={2}
                />
              </g>
            )}
          </Box>
        </Box>
        {/* O tooltip vive FORA do svg, como texto normal: não colide com a
            curva e continua legível em qualquer zoom. */}
        <Typography variant="body2" sx={{ mt: 1, minHeight: 22 }}>
          {focoPonto ? (
            <>
              <strong>{horaDe(focoPonto.capturedAt)}</strong> ·{' '}
              {formatar(focoPonto.viewerCount ?? 0)} assistindo
              {focoPonto.likes > 0 && ` · ${formatar(focoPonto.likes)} curtidas`}
              {focoPonto.gifts > 0 && ` · ${focoPonto.gifts} presentes`}
              {focoPonto.follows > 0 && ` · ${focoPonto.follows} seguidores`}
            </>
          ) : (
            <Box component="span" sx={{ color: 'text.secondary' }}>
              Pico de {formatar(run.peakViewers)} pessoas.
            </Box>
          )}
        </Typography>
      </CardContent>
    </Card>
  );
}

function LinhaDeQa({ item }: { item: LiveRunQa }) {
  const hora = new Date(item.receivedAt).toLocaleTimeString('pt-BR', {
    hour: '2-digit',
    minute: '2-digit',
  });

  return (
    <Box
      sx={{
        p: 1.75,
        borderRadius: 2,
        border: '1px solid',
        borderColor: 'divider',
        // A escalada sem resposta é a linha que pede ação — ela ganha o fio
        // de aviso; o resto fica neutro para não virar árvore de natal.
        ...(item.answer === null && {
          borderLeft: '3px solid',
          borderLeftColor: 'warning.main',
        }),
      }}
    >
      <Stack
        direction="row"
        spacing={1}
        alignItems="baseline"
        flexWrap="wrap"
        useFlexGap
      >
        <Typography variant="caption" color="text.secondary">
          {hora}
        </Typography>
        <Typography fontWeight={700} sx={{ flex: 1, minWidth: 200 }}>
          {item.question}
        </Typography>
        {item.repeatCount > 1 && (
          <Tooltip title="Quantas pessoas fizeram esta mesma pergunta">
            <Chip size="small" variant="outlined" label={`×${item.repeatCount}`} />
          </Tooltip>
        )}
        {seloDeDesfecho(item)}
      </Stack>
      {item.answer !== null ? (
        <Typography
          variant="body2"
          color="text.secondary"
          sx={{ mt: 0.75, lineHeight: 1.55 }}
        >
          {item.answer}
        </Typography>
      ) : (
        <Typography variant="body2" color="text.secondary" sx={{ mt: 0.75 }}>
          O copiloto não sustentou esta e passou para você. Se ela se repete,
          vale colocar a resposta na base.
        </Typography>
      )}
    </Box>
  );
}

/** Um selo só por linha: o desfecho mais forte ganha. */
function seloDeDesfecho(item: LiveRunQa) {
  if (item.deliveryStatus === 'enviada')
    return <Chip size="small" color="success" variant="outlined" label="enviada no chat" />;
  if (item.deliveryStatus === 'falhou')
    return (
      <Tooltip title={item.failureReason ?? ''}>
        <Chip size="small" color="error" variant="outlined" label="falhou o envio" />
      </Tooltip>
    );
  if (item.copiedAt)
    return <Chip size="small" color="success" variant="outlined" label="você usou" />;
  if (item.answer === null)
    return <Chip size="small" color="warning" variant="outlined" label="ficou com você" />;
  return null;
}

/** 12 345 → "12,3 mil": número de live se lê de relance ou não se lê. */
function formatar(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} mi`;
  if (n >= 10_000) return `${(n / 1_000).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} mil`;
  return n.toLocaleString('pt-BR');
}
