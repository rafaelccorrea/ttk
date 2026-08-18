import { useEffect, useState } from 'react';
import { billingService, type Wallet } from '@/services/billing.service';

export interface SaldoDaAcao {
  /** Créditos que a conta tem agora. `null` enquanto a carteira não chegou. */
  saldo: number | null;
  /** Quanto esta ação custa, segundo a tabela do backend. */
  custo: number | null;
  /** Conta interna: não debita nada, nunca bloqueia. */
  ilimitado: boolean;
  /** Sabemos que a chamada vai falhar por saldo? */
  insuficiente: boolean;
  /** Texto pronto para o tooltip do botão travado. */
  motivo: string;
  /** Conta sem assinatura — muda o CTA de "compre um pacote" para "assine". */
  semPlano: boolean;
  /** Para reconsultar depois de gastar. */
  recarregar: () => void;
}

/**
 * "Este botão vai funcionar?" respondido ANTES do clique.
 *
 * O backend recusa por saldo com 402 e uma mensagem boa, mas descobrir isso
 * clicando é a pior ordem possível: a pessoa preenche o formulário inteiro,
 * manda, espera, e só então ouve que não dava. Pior ainda na conta gratuita,
 * onde o saldo acaba rápido e é justamente o momento em que ela decide se
 * assina — a hora de mostrar o caminho, não um erro.
 *
 * A autoridade continua sendo o servidor: isto é UX. O saldo pode mudar em
 * outra aba, e o 402 segue existindo como rede de segurança.
 */
export function useSaldo(acao: string): SaldoDaAcao {
  const [wallet, setWallet] = useState<Wallet | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let ativo = true;
    billingService
      .wallet()
      .then((w) => ativo && setWallet(w))
      // Sem carteira, não travamos nada: o backend barra, e um botão
      // desabilitado por falha de rede seria pior do que um 402.
      .catch(() => undefined);
    return () => {
      ativo = false;
    };
  }, [tick]);

  const custo = wallet?.prices?.[acao]?.credits ?? null;
  const saldo = wallet ? wallet.credits : null;
  const ilimitado = Boolean(wallet?.unlimited);
  const semPlano = wallet?.plan === 'free';
  const insuficiente =
    !ilimitado && saldo !== null && custo !== null && saldo < custo;

  return {
    saldo,
    custo,
    ilimitado,
    insuficiente,
    semPlano,
    motivo: insuficiente
      ? `Esta ação custa ${custo} créditos e você tem ${saldo}. ${
          semPlano
            ? 'Assine um plano em Planos & Créditos para continuar.'
            : 'Compre um pacote ou faça upgrade em Planos & Créditos.'
        }`
      : '',
    recarregar: () => setTick((t) => t + 1),
  };
}
