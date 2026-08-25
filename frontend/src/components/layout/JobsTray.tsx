import CheckCircleRoundedIcon from '@mui/icons-material/CheckCircleRounded';
import CloseRoundedIcon from '@mui/icons-material/CloseRounded';
import ErrorRoundedIcon from '@mui/icons-material/ErrorRounded';
import ExpandLessRoundedIcon from '@mui/icons-material/ExpandLessRounded';
import ExpandMoreRoundedIcon from '@mui/icons-material/ExpandMoreRounded';
import {
  Box,
  Collapse,
  IconButton,
  LinearProgress,
  Paper,
  Stack,
  Typography,
} from '@mui/material';
import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AiJob, JOB_STARTED_EVENT, jobsService, rotaDoJob } from '@/services/jobs.service';

/** Rápido enquanto há trabalho rodando; lento só para pegar o que outra aba criou. */
const POLL_ATIVO_MS = 4000;
const POLL_OCIOSO_MS = 60_000;

/**
 * Progresso global das gerações de IA. Fica em toda página da área logada:
 * o usuário dispara uma transcrição, vai olhar produtos e, quando volta, o
 * resultado está lá — nada morre porque a tela mudou.
 */
export function JobsTray() {
  const [jobs, setJobs] = useState<AiJob[]>([]);
  const [aberto, setAberto] = useState(true);
  const navigate = useNavigate();

  const recarregar = useCallback(async () => {
    try {
      setJobs(await jobsService.ativos());
    } catch {
      /* sem sessão ou rede: a bandeja só fica vazia */
    }
  }, []);

  useEffect(() => {
    void recarregar();
    window.addEventListener(JOB_STARTED_EVENT, recarregar);
    return () => window.removeEventListener(JOB_STARTED_EVENT, recarregar);
  }, [recarregar]);

  const ativo = jobs.some((j) => j.status === 'na_fila' || j.status === 'rodando');
  useEffect(() => {
    const timer = setInterval(recarregar, ativo ? POLL_ATIVO_MS : POLL_OCIOSO_MS);
    return () => clearInterval(timer);
  }, [ativo, recarregar]);

  async function dispensar(job: AiJob) {
    setJobs((prev) => prev.filter((j) => j.id !== job.id));
    await jobsService.dispensar(job.id).catch(() => undefined);
  }

  if (!jobs.length) return null;

  const rodando = jobs.filter((j) => j.status === 'na_fila' || j.status === 'rodando').length;

  return (
    <Paper
      elevation={8}
      sx={{
        position: 'fixed',
        left: { xs: 12, sm: 20 },
        bottom: { xs: 12, sm: 20 },
        width: { xs: 'calc(100vw - 24px)', sm: 340 },
        zIndex: (t) => t.zIndex.snackbar,
        borderRadius: 2,
        overflow: 'hidden',
      }}
    >
      <Stack
        direction="row"
        alignItems="center"
        px={1.5}
        py={0.75}
        sx={{ cursor: 'pointer', bgcolor: 'background.paper' }}
        onClick={() => setAberto((v) => !v)}
      >
        <Typography variant="subtitle2" flexGrow={1}>
          {rodando
            ? `Gerando em segundo plano (${rodando})`
            : 'Gerações concluídas'}
        </Typography>
        <IconButton size="small" aria-label={aberto ? 'Recolher' : 'Expandir'}>
          {aberto ? <ExpandMoreRoundedIcon /> : <ExpandLessRoundedIcon />}
        </IconButton>
      </Stack>
      {rodando > 0 && !aberto && <LinearProgress />}
      <Collapse in={aberto}>
        <Stack divider={<Box borderTop={1} borderColor="divider" />}>
          {jobs.map((job) => {
            const vivo = job.status === 'na_fila' || job.status === 'rodando';
            return (
              <Box key={job.id} px={1.5} py={1}>
                <Stack direction="row" alignItems="flex-start" spacing={1}>
                  {job.status === 'concluido' && (
                    <CheckCircleRoundedIcon color="success" fontSize="small" sx={{ mt: 0.25 }} />
                  )}
                  {job.status === 'falhou' && (
                    <ErrorRoundedIcon color="error" fontSize="small" sx={{ mt: 0.25 }} />
                  )}
                  <Box
                    flexGrow={1}
                    minWidth={0}
                    sx={{ cursor: 'pointer' }}
                    onClick={() => navigate(rotaDoJob(job))}
                  >
                    <Typography variant="body2" noWrap fontWeight={600}>
                      {job.titulo}
                    </Typography>
                    <Typography variant="caption" color="text.secondary" noWrap display="block">
                      {job.status === 'falhou'
                        ? job.erro ?? 'Falhou'
                        : job.status === 'concluido'
                          ? 'Pronto — clique para ver'
                          : job.etapa ?? 'Na fila'}
                    </Typography>
                    {vivo && (
                      <LinearProgress
                        variant={job.progresso > 0 ? 'determinate' : 'indeterminate'}
                        value={job.progresso}
                        sx={{ mt: 0.75, borderRadius: 1 }}
                      />
                    )}
                  </Box>
                  {!vivo && (
                    <IconButton size="small" aria-label="Dispensar" onClick={() => dispensar(job)}>
                      <CloseRoundedIcon fontSize="small" />
                    </IconButton>
                  )}
                </Stack>
              </Box>
            );
          })}
        </Stack>
      </Collapse>
    </Paper>
  );
}
