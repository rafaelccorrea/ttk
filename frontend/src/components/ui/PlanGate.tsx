import LockRoundedIcon from '@mui/icons-material/LockRounded';
import { Box, Button, Chip, Typography } from '@mui/material';
import { ReactNode, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { BrandLoader } from '@/components/ui/BrandLoader';
import { billingService } from '@/services/billing.service';

const PLAN_LABEL: Record<string, string> = {
  free: 'Free',
  starter: 'Starter', // legado: fora do catálogo, ainda tem assinante

  pro: 'Pro',
  business: 'Business',
};

interface PlanGateProps {
  /** Chave do recurso (igual ao backend: ingestion, ai_videos...). */
  feature: string;
  children: ReactNode;
}

/**
 * Bloqueia a tela se o plano do usuário não inclui o recurso, com CTA de
 * upgrade. O backend é a autoridade (403 nas APIs); isto é só a UX.
 */
export function PlanGate({ feature, children }: PlanGateProps) {
  const [allowed, setAllowed] = useState<boolean | null>(null);
  const [minPlan, setMinPlan] = useState<string>('pro');

  useEffect(() => {
    billingService
      .wallet()
      .then((w) => {
        setAllowed(w.features?.[feature] ?? true);
        setMinPlan(w.featureMinPlan?.[feature] ?? 'pro');
      })
      .catch(() => setAllowed(true)); // em erro, deixa o backend barrar
  }, [feature]);

  if (allowed === null) return <BrandLoader label="Verificando seu plano..." />;
  if (allowed) return <>{children}</>;

  return (
    <Box
      sx={{
        border: '1px dashed rgba(22,24,35,0.15)',
        borderRadius: 4,
        p: { xs: 4, md: 8 },
        textAlign: 'center',
        maxWidth: 560,
        mx: 'auto',
        mt: 6,
      }}
    >
      <LockRoundedIcon sx={{ fontSize: 44, color: '#fe2c55', mb: 1 }} />
      <Typography variant="h6" fontWeight={800} mb={0.5}>
        Recurso exclusivo do plano {PLAN_LABEL[minPlan] ?? minPlan}
      </Typography>
      <Typography color="text.secondary" mb={2.5}>
        Faça upgrade para desbloquear esta área e aproveitar tudo que o PikPok
        oferece para escalar sua operação.
      </Typography>
      <Chip
        label={`Disponível a partir do ${PLAN_LABEL[minPlan] ?? minPlan}`}
        size="small"
        sx={{ mb: 2.5, fontWeight: 700 }}
      />
      <Box>
        <Button component={Link} to="/planos" variant="contained" size="large">
          Ver planos
        </Button>
      </Box>
    </Box>
  );
}
