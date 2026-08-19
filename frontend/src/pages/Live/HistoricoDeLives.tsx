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
                <TableCell>Quando</TableCell>
                <TableCell align="right">Público</TableCell>
                <TableCell align="right">Curtidas</TableCell>
                <TableCell align="right">Perguntas</TableCell>
                <TableCell align="right">Respostas</TableCell>
                <TableCell align="right">Aproveitamento</TableCell>
                <TableCell align="right">Escalações</TableCell>
                <TableCell align="right">Resposta em</TableCell>
                <TableCell align="right">Minutos</TableCell>
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
                    <Stack direction="row" spacing={1} alignItems="center">
                      <span>{quando(run.startedAt)}</span>
                      {run.status === 'erro' && (
                        <Chip size="small" color="warning" label="interrompida" />
                      )}
                      {run.mode === 'auto' && (
                        <Chip size="small" variant="outlined" label="automático" />
                      )}
                    </Stack>
                  </TableCell>
                  <TableCell align="right">
                    <Tooltip title="Pico de pessoas assistindo. Vazio em lives de antes da captura de audiência.">
                      <span>{run.peakViewers > 0 ? run.peakViewers : '—'}</span>
                    </Tooltip>
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
                  <TableCell align="right">
                    <Tooltip title="Perguntas que o copiloto não sustentou e passou para você. Muitas indicam buracos na base.">
                      <span>{run.escalations}</span>
                    </Tooltip>
                  </TableCell>
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
