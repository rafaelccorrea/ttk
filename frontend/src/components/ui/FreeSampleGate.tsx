import { ReactElement, useEffect, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { BrandLoader } from '@/components/ui/BrandLoader';
import { billingService } from '@/services/billing.service';

interface FreeSampleGateProps {
  /** A tela completa, para quem assina. */
  pago: ReactElement;
  /** A amostra, para quem ainda não assina. */
  amostra: ReactElement;
}

/**
 * A terceira resposta da descoberta.
 *
 * Até aqui a pergunta "esta conta entra?" tinha duas saídas: entra (assinante)
 * ou vai para `/assinatura` (todo o resto). O modo amostra
 * (`docs/CONTA-FREE.md`) acrescenta uma terceira — entra, mas numa versão
 * reduzida e fixa —, e ela vale só para as telas de descoberta. Todo o resto do
 * app continua com o paywall na entrada, via `RequireSubscription`.
 *
 * Quem decide é `freeSample.active`, vindo do backend, e não uma comparação de
 * plano feita aqui: a regra de quem entra na amostra também existe no servidor
 * (`FreePlanGuard`), e duas cópias da mesma regra em lugares diferentes é como
 * elas passam a discordar.
 *
 * Em erro de rede a decisão é a mesma do `RequireSubscription`: deixa passar
 * pela porta paga e o backend barra: trancar alguém fora do app por uma falha
 * momentânea de `/wallet` seria pior do que deixá-lo bater no 403.
 */
export function FreeSampleGate({ pago, amostra }: FreeSampleGateProps) {
  const [estado, setEstado] = useState<'carregando' | 'amostra' | 'pago' | 'sem-acesso'>(
    'carregando',
  );

  useEffect(() => {
    let ativo = true;
    billingService
      .wallet()
      .then((w) => {
        if (!ativo) return;
        if (w.freeSample?.active) return setEstado('amostra');
        /*
         * Sem assinatura E sem modo amostra: é o caso do backend antigo (ou de
         * uma conta em estado que este front não conhece). Cai no paywall, que
         * é o comportamento seguro — mostrar a tela paga seria entregar dado.
         */
        if (w.plan === 'free') return setEstado('sem-acesso');
        setEstado('pago');
      })
      .catch(() => ativo && setEstado('pago'));
    return () => {
      ativo = false;
    };
  }, []);

  if (estado === 'carregando') return <BrandLoader label="Carregando..." />;
  if (estado === 'sem-acesso') return <Navigate to="/assinatura" replace />;
  return estado === 'amostra' ? amostra : pago;
}
