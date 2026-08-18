import ConstructionRoundedIcon from '@mui/icons-material/ConstructionRounded';
import LockRoundedIcon from '@mui/icons-material/LockRounded';
import { Box, Button, Chip, Typography } from '@mui/material';
import { ReactNode, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { BrandLoader } from '@/components/ui/BrandLoader';
import { billingService } from '@/services/billing.service';

/**
 * Hierarquia dos planos — espelha o PLAN_RANK do backend.
 *
 * Existe aqui por um motivo específico: sem ela, a tela não consegue distinguir
 * "você não paga por isso" de "isto ainda não existe", e as duas chegam do
 * backend do mesmo jeito — `features[x] === false`.
 */
const PLAN_RANK: Record<string, number> = {
  free: 0,
  starter: 1,
  essencial: 1,
  pro: 2,
  business: 3,
};

const PLAN_LABEL: Record<string, string> = {
  free: 'Free',
  starter: 'Starter', // legado: fora do catálogo, ainda tem assinante
  essencial: 'Essencial',
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
  const [plan, setPlan] = useState<string>('free');

  useEffect(() => {
    billingService
      .wallet()
      .then((w) => {
        setAllowed(w.features?.[feature] ?? true);
        setMinPlan(w.featureMinPlan?.[feature] ?? 'pro');
        setPlan(w.plan ?? 'free');
      })
      .catch(() => setAllowed(true)); // em erro, deixa o backend barrar
  }, [feature]);

  // Mesmo motivo do RequireSubscription: o rótulo é sobre a tela que vem, não
  // sobre a conferência de plano que roda por trás.
  if (allowed === null) return <BrandLoader label="Carregando..." />;
  if (allowed) return <>{children}</>;

  /*
   * Bloqueado, mas o plano JÁ alcança o mínimo? Então não é dinheiro que falta:
   * é o recurso que ainda não foi liberado (ver FEATURES_NAO_LANCADAS no
   * backend). Mandar um assinante do Business "fazer upgrade para Business" é a
   * pior mensagem que esta tela pode dar — ele já pagou, e ela está dizendo que
   * a culpa é dele. As duas situações chegam aqui idênticas (`features[x]
   * === false`), e é a comparação de plano que as separa.
   */
  if ((PLAN_RANK[plan] ?? 0) >= (PLAN_RANK[minPlan] ?? 0)) {
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
        <ConstructionRoundedIcon sx={{ fontSize: 44, color: '#fe2c55', mb: 1 }} />
        <Typography variant="h6" fontWeight={800} mb={0.5}>
          Estamos terminando de construir isto
        </Typography>
        <Typography color="text.secondary" mb={2.5}>
          Seu plano já inclui este recurso — ele só ainda não foi liberado.
          Avisamos assim que estiver no ar.
        </Typography>
        <Chip label="Em desenvolvimento" size="small" sx={{ fontWeight: 700 }} />
      </Box>
    );
  }

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
