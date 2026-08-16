import { Navigate, Outlet } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { BrandLoader } from '@/components/ui/BrandLoader';
import { billingService } from '@/services/billing.service';

/**
 * Paywall na entrada: conta no plano `free` é "cadastro feito, pagamento
 * pendente" — ou assinatura encerrada, que volta ao mesmo estado. Nos dois
 * casos a pessoa sai do app inteiro e vai para `/assinatura`, que fica fora do
 * AppLayout: sem menu, sem telas de fundo estourando 403.
 *
 * Isto é só a UX — a autoridade é o backend, que barra todas as rotas de dado e
 * de IA pelo PlanFeatureGuard.
 *
 * Em erro de rede a decisão é deixar passar: o backend barra de qualquer jeito,
 * e trancar o usuário fora do app por uma falha momentânea de /wallet seria
 * pior do que deixá-lo bater no 403.
 */
export function RequireSubscription() {
  const [plan, setPlan] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    billingService
      .wallet()
      .then((w) => active && setPlan(w.plan))
      .catch(() => active && setPlan('unknown'));
    return () => {
      active = false;
    };
  }, []);

  if (plan === null) return <BrandLoader label="Verificando sua assinatura..." />;
  if (plan === 'free') return <Navigate to="/assinatura" replace />;
  return <Outlet />;
}
