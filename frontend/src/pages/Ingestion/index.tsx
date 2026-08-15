import BoltRoundedIcon from '@mui/icons-material/BoltRounded';
import CheckCircleRoundedIcon from '@mui/icons-material/CheckCircleRounded';
import ErrorRoundedIcon from '@mui/icons-material/ErrorRounded';
import PlayArrowRoundedIcon from '@mui/icons-material/PlayArrowRounded';
import ScheduleRoundedIcon from '@mui/icons-material/ScheduleRounded';
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  FormControlLabel,
  Grid,
  MenuItem,
  Switch,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import { useCallback, useEffect, useState } from 'react';
import {
  IngestionRun,
  IngestionStatus,
  ingestionService,
} from '@/services/ingestion.service';
import { ScrollX } from '@/components/ui/ScrollX';

// Presets amigáveis; "custom" libera o campo de expressão cron.
const PRESETS: Array<{ label: string; cron: string }> = [
  { label: 'Diário às 06:00', cron: '0 0 6 * * *' },
  { label: '2x ao dia (06h e 18h)', cron: '0 0 6,18 * * *' },
  { label: 'A cada 6 horas', cron: '0 0 */6 * * *' },
  { label: 'A cada hora', cron: '0 0 * * * *' },
  { label: 'Semanal (segunda 06:00)', cron: '0 0 6 * * 1' },
];

function formatDateTime(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
}

function durationOf(run: IngestionRun): string {
  if (!run.finishedAt) return '…';
  const secs = Math.round((new Date(run.finishedAt).getTime() - new Date(run.startedAt).getTime()) / 1000);
  return secs >= 60 ? `${Math.floor(secs / 60)}m${secs % 60}s` : `${secs}s`;
}

function StatusChip({ status }: { status: IngestionRun['status'] }) {
  if (status === 'success')
    return <Chip size="small" icon={<CheckCircleRoundedIcon />} label="sucesso" color="success" sx={{ fontWeight: 700 }} />;
  if (status === 'error')
    return <Chip size="small" icon={<ErrorRoundedIcon />} label="erro" color="error" sx={{ fontWeight: 700 }} />;
  return <Chip size="small" icon={<CircularProgress size={12} color="inherit" />} label="rodando" sx={{ fontWeight: 700 }} />;
}

export function IngestionPage() {
  const [status, setStatus] = useState<IngestionStatus | null>(null);
  const [runs, setRuns] = useState<IngestionRun[]>([]);
  const [cronExpr, setCronExpr] = useState('');
  const [saving, setSaving] = useState(false);
  const [triggering, setTriggering] = useState(false);
  const [feedback, setFeedback] = useState<{ kind: 'success' | 'error'; text: string } | null>(null);

  const load = useCallback(async () => {
    const [s, r] = await Promise.all([ingestionService.status(), ingestionService.runs(20)]);
    setStatus(s);
    setRuns(r);
    setCronExpr((prev) => prev || s.cronExpr);
    return s;
  }, []);

  useEffect(() => {
    load().catch(console.error);
  }, [load]);

  // Enquanto uma execução está rodando, atualiza o painel a cada 5s.
  useEffect(() => {
    if (!status?.isRunning && !triggering) return;
    const timer = setInterval(() => load().catch(() => undefined), 5000);
    return () => clearInterval(timer);
  }, [status?.isRunning, triggering, load]);

  async function saveSchedule(input: { cronExpr?: string; enabled?: boolean }) {
    setSaving(true);
    setFeedback(null);
    try {
      const s = await ingestionService.updateSchedule(input);
      setStatus(s);
      if (input.cronExpr) setCronExpr(s.cronExpr);
      setFeedback({ kind: 'success', text: 'Agendamento atualizado.' });
    } catch (err) {
      setFeedback({
        kind: 'error',
        text: err instanceof Error ? err.message : 'Falha ao salvar o agendamento',
      });
    } finally {
      setSaving(false);
    }
  }

  async function triggerNow() {
    setTriggering(true);
    setFeedback(null);
    try {
      const run = await ingestionService.run();
      setFeedback(
        run.status === 'success'
          ? {
              kind: 'success',
              text: `Coleta concluída: ${run.hashtagsFetched} hashtags, ${run.creatorsFetched} criadores, ${run.videosUpserted} vídeos.`,
            }
          : { kind: 'error', text: `Coleta falhou: ${run.error}` },
      );
      await load();
    } catch (err) {
      setFeedback({
        kind: 'error',
        text: err instanceof Error ? err.message : 'Falha ao disparar a coleta',
      });
    } finally {
      setTriggering(false);
    }
  }

  const preset = PRESETS.find((p) => p.cron === cronExpr);

  return (
    <>
      <Typography variant="h5" gutterBottom>
        Coleta de dados (scraper)
      </Typography>
      <Typography color="text.secondary" mb={3}>
        Controle do robô que coleta hashtags, criadores e vídeos reais do TikTok Creative Center.
      </Typography>

      {feedback && (
        <Alert severity={feedback.kind} sx={{ mb: 2 }} onClose={() => setFeedback(null)}>
          {feedback.text}
        </Alert>
      )}

      <Grid container spacing={2} mb={3}>
        {/* Status atual */}
        <Grid item xs={12} md={4}>
          <Card sx={{ height: '100%' }}>
            <CardContent>
              <Box display="flex" alignItems="center" gap={1} mb={1.5}>
                <BoltRoundedIcon color="primary" />
                <Typography fontWeight={700}>Status</Typography>
              </Box>
              <Typography variant="body2" color="text.secondary">
                Última execução
              </Typography>
              <Box display="flex" alignItems="center" gap={1} mb={1}>
                <Typography fontWeight={700}>
                  {formatDateTime(status?.lastRun?.startedAt ?? null)}
                </Typography>
                {status?.lastRun && <StatusChip status={status.lastRun.status} />}
              </Box>
              <Typography variant="body2" color="text.secondary">
                Próxima execução automática
              </Typography>
              <Typography fontWeight={700}>
                {status?.enabled ? formatDateTime(status?.nextRunAt ?? null) : 'agendamento desligado'}
              </Typography>
              <Button
                variant="contained"
                startIcon={triggering ? <CircularProgress size={16} color="inherit" /> : <PlayArrowRoundedIcon />}
                disabled={triggering || status?.isRunning}
                onClick={triggerNow}
                sx={{ mt: 2 }}
                fullWidth
              >
                {triggering || status?.isRunning ? 'Coletando… (~1 min)' : 'Executar agora'}
              </Button>
            </CardContent>
          </Card>
        </Grid>

        {/* Agendamento */}
        <Grid item xs={12} md={8}>
          <Card sx={{ height: '100%' }}>
            <CardContent>
              <Box display="flex" alignItems="center" justifyContent="space-between" mb={1.5}>
                <Box display="flex" alignItems="center" gap={1}>
                  <ScheduleRoundedIcon color="primary" />
                  <Typography fontWeight={700}>Agendamento automático</Typography>
                </Box>
                <FormControlLabel
                  control={
                    <Switch
                      checked={status?.enabled ?? false}
                      disabled={saving}
                      onChange={(e) => saveSchedule({ enabled: e.target.checked })}
                    />
                  }
                  label={status?.enabled ? 'Ativo' : 'Desligado'}
                />
              </Box>
              <Grid container spacing={2} alignItems="center">
                <Grid item xs={12} sm={5}>
                  <TextField
                    select
                    fullWidth
                    label="Frequência"
                    value={preset ? preset.cron : 'custom'}
                    onChange={(e) => {
                      if (e.target.value !== 'custom') setCronExpr(e.target.value);
                    }}
                  >
                    {PRESETS.map((p) => (
                      <MenuItem key={p.cron} value={p.cron}>
                        {p.label}
                      </MenuItem>
                    ))}
                    <MenuItem value="custom">Personalizado (cron)</MenuItem>
                  </TextField>
                </Grid>
                <Grid item xs={12} sm={4}>
                  <Tooltip title="6 campos: segundo minuto hora dia mês dia-da-semana">
                    <TextField
                      fullWidth
                      label="Expressão cron"
                      value={cronExpr}
                      onChange={(e) => setCronExpr(e.target.value)}
                    />
                  </Tooltip>
                </Grid>
                <Grid item xs={12} sm={3}>
                  <Button
                    fullWidth
                    variant="outlined"
                    disabled={saving || !cronExpr || cronExpr === status?.cronExpr}
                    onClick={() => saveSchedule({ cronExpr })}
                  >
                    {saving ? 'Salvando…' : 'Salvar'}
                  </Button>
                </Grid>
              </Grid>
              <Typography variant="caption" color="text.secondary" display="block" mt={1.5}>
                Cadência recomendada: 1–2x ao dia. O Creative Center limita usuários anônimos, então
                intervalos muito curtos não trazem mais dados e aumentam o risco de bloqueio.
              </Typography>
            </CardContent>
          </Card>
        </Grid>
      </Grid>

      {/* Histórico */}
      <Typography variant="h6" mb={1}>
        Histórico de execuções
      </Typography>
      {runs.length === 0 ? (
        <Typography color="text.secondary">Nenhuma execução registrada ainda.</Typography>
      ) : (
        <ScrollX>
        <Table size="small" sx={{ minWidth: 720 }}>
          <TableHead>
            <TableRow>
              <TableCell>Início</TableCell>
              <TableCell>Disparo</TableCell>
              <TableCell>Status</TableCell>
              <TableCell align="right">Hashtags</TableCell>
              <TableCell align="right">Criadores</TableCell>
              <TableCell align="right">Vídeos</TableCell>
              <TableCell align="right">Duração</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {runs.map((run) => (
              <TableRow key={run.id}>
                <TableCell>{formatDateTime(run.startedAt)}</TableCell>
                <TableCell>
                  <Chip
                    size="small"
                    label={run.trigger === 'cron' ? 'automático' : 'manual'}
                    sx={{ fontWeight: 600 }}
                  />
                </TableCell>
                <TableCell>
                  <Tooltip title={run.error ?? ''}>
                    <span>
                      <StatusChip status={run.status} />
                    </span>
                  </Tooltip>
                </TableCell>
                <TableCell align="right">{run.hashtagsFetched}</TableCell>
                <TableCell align="right">{run.creatorsFetched}</TableCell>
                <TableCell align="right">{run.videosUpserted}</TableCell>
                <TableCell align="right">{durationOf(run)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        </ScrollX>
      )}
    </>
  );
}
