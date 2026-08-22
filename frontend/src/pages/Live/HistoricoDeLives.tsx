import HistoryRoundedIcon from '@mui/icons-material/HistoryRounded';
import {
  Box,
  Card,
  CardContent,
  Chip,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Tooltip,
  Typography,
} from '@mui/material';
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ScrollX } from '@/components/ui/ScrollX';
import { LiveRunResumo, liveService } from '@/services/live.service';

/**
 * O histórico das transmissões.
 *
 * Estes números eram gravados desde a primeira versão e viviam só no banco: o
 * vendedor pagava por hora de copiloto sem nenhuma forma de saber se ele
 * ajudou. Decidir renovar o Business virava palpite — e é o tipo de assinatura
 * que não se renova no escuro.
 *
 * A coluna que importa é **aproveitamento**: das respostas que o copiloto
 * entregou, quantas ele de fato usou. As outras são contadores de atividade, e
 * contador de atividade sobe igual quando o produto funciona e quando não
 * funciona — mil mensagens vistas não dizem nada sobre acerto.
 */
export function HistoricoDeLives() {
  const navigate = useNavigate();
  const [runs, setRuns] = useState<LiveRunResumo[] | null>(null);

  useEffect(() => {
    liveService
      .listRuns()
      .then(setRuns)
      // Falha aqui não merece alarme: o histórico é complemento, e a ausência
      // dele não impede ninguém de montar a base nem de entrar ao vivo.
      .catch(() => setRuns([]));
  }, []);

  // Sem transmissão nenhuma o bloco não aparece. Uma tabela vazia com cinco
  // cabeçalhos só ocupa a tela de quem ainda nem começou.
  if (!runs?.length) return null;

  return (
    <Card sx={{ mb: 3 }}>
      <CardContent>
        <Stack direction="row" spacing={1} alignItems="center" mb={0.5}>
          <HistoryRoundedIcon sx={{ color: 'text.secondary', fontSize: 20 }} />
          <Typography fontWeight={800}>Suas transmissões</Typography>
        </Stack>
        <Typography variant="body2" color="text.secondary" mb={2}>
          Aproveitamento é quanto das respostas do copiloto você usou de verdade
          — é o número que diz se ele está acertando. Clique numa linha para ver
          a live inteira: público, perguntas e respostas.
        </Typography>

        <ScrollX>
          <Table size="small">
            <TableHead>
              <TableRow>
                {/* Cada cabeçalho explica COMO o número é medido. É onde a
                    dúvida nasce ("perguntas conta emoji?") — a explicação nas
                    células só aparecia depois que a pessoa já tinha desconfiado
                    do valor. */}
                <Cabecalho
                  titulo="Quando"
                  medida="Início da transmissão, no seu fuso horário."
                  esquerda
                />
                <Cabecalho
                  titulo="Público"
                  medida="Pico de pessoas assistindo ao mesmo tempo, lido do próprio TikTok pelo app. Vazio em lives de antes da captura de audiência."
                />
                <Cabecalho
                  titulo="Curtidas"
                  medida="Total de curtidas recebidas durante a transmissão."
                />
                <Cabecalho
                  titulo="Perguntas"
                  medida="Mensagens do chat que o copiloto leu — depois da sua lista de palavras bloqueadas, antes de decidir se respondia."
                />
                <Cabecalho
                  titulo="Respostas"
                  medida="Respostas que o copiloto gerou e mostrou no painel."
                />
                <Cabecalho
                  titulo="Aproveitamento"
                  medida="Das respostas geradas, quantas você usou de verdade (copiou ou salvou na base). É a métrica de acerto do copiloto."
                />
                <Cabecalho
                  titulo="Escalações"
                  medida="Perguntas que o copiloto não sustentou e passou para você. Muitas indicam buracos na base."
                />
                <Cabecalho
                  titulo="Resposta em"
                  medida="Tempo típico (mediana) entre a pergunta chegar e a resposta ficar pronta."
                />
                <Cabecalho
                  titulo="Minutos"
                  medida="Minutos de copiloto no ar, cobrados da sua carteira de live."
                />
              </TableRow>
            </TableHead>
            <TableBody>
              {runs.map((run) => (
                <TableRow
                  key={run.id}
                  hover
                  onClick={() => navigate(`/copiloto/lives/${run.id}`)}
                  sx={{ cursor: 'pointer' }}
                >
                  <TableCell>
                    <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
                      <Box component="span" sx={{ whiteSpace: 'nowrap' }}>
                        {quando(run.startedAt)}
                      </Box>
                      {run.status === 'erro' && (
                        <Chip size="small" color="warning" label="interrompida" />
                      )}
                      {run.mode === 'auto' && (
                        <Chip size="small" variant="outlined" label="automático" />
                      )}
                    </Stack>
                  </TableCell>
                  <TableCell align="right">
                    {run.peakViewers > 0 ? run.peakViewers : '—'}
                  </TableCell>
                  <TableCell align="right">
                    {run.totalLikes > 0 ? run.totalLikes : '—'}
                  </TableCell>
                  <TableCell align="right">{run.messagesSeen}</TableCell>
                  <TableCell align="right">{run.repliesGenerated}</TableCell>
                  <TableCell align="right">
                    <Tooltip
                      title={
                        run.usageRate === null
                          ? 'Esta transmissão não gerou resposta nenhuma.'
                          : `${run.repliesUsed} de ${run.repliesGenerated} respostas usadas`
                      }
                    >
                      <Box component="span" fontWeight={700}>
                        {aproveitamento(run.usageRate)}
                      </Box>
                    </Tooltip>
                  </TableCell>
                  <TableCell align="right">{run.escalations}</TableCell>
                  <TableCell align="right">{latencia(run.latencyP50Ms)}</TableCell>
                  <TableCell align="right">{run.minutesCharged}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </ScrollX>
      </CardContent>
    </Card>
  );
}

/**
 * Cabeçalho com a definição da medida no hover. O pontilhado embaixo do texto
 * é o convite — sem ele ninguém descobre que o hover existe.
 */
function Cabecalho({
  titulo,
  medida,
  esquerda = false,
}: {
  titulo: string;
  medida: string;
  esquerda?: boolean;
}) {
  return (
    <TableCell align={esquerda ? 'left' : 'right'}>
      <Tooltip title={medida}>
        <Box
          component="span"
          sx={{
            cursor: 'help',
            textDecoration: 'underline dotted',
            textUnderlineOffset: 3,
            textDecorationColor: 'rgba(22,24,35,0.3)',
          }}
        >
          {titulo}
        </Box>
      </Tooltip>
    </TableCell>
  );
}

/** "hoje, 14:32", "ontem, 20:10", "12/08 às 19:45". */
export function quando(iso: string | null): string {
  if (!iso) return '—';
  const data = new Date(iso);
  const hora = data.toLocaleTimeString('pt-BR', {
    hour: '2-digit',
    minute: '2-digit',
  });

  // Comparação por DIA DO CALENDÁRIO, não por diferença de 24h: uma live das
  // 23h vista às 8h da manhã seguinte é "ontem", não "hoje".
  const hoje = new Date();
  const mesmoDia = (a: Date, b: Date) =>
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate();

  if (mesmoDia(data, hoje)) return `hoje, ${hora}`;

  const ontem = new Date(hoje);
  ontem.setDate(hoje.getDate() - 1);
  if (mesmoDia(data, ontem)) return `ontem, ${hora}`;

  return `${data.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })} às ${hora}`;
}

export function aproveitamento(taxa: number | null): string {
  if (taxa === null) return '—';
  return `${Math.round(taxa * 100)}%`;
}

export function latencia(ms: number | null): string {
  if (ms === null) return '—';
  // Abaixo de um segundo o número exato não muda nada para quem lê; acima de
  // dez, a casa decimal também não.
  if (ms < 1000) return '<1s';
  const segundos = ms / 1000;
  return segundos < 10 ? `${segundos.toFixed(1)}s` : `${Math.round(segundos)}s`;
}
