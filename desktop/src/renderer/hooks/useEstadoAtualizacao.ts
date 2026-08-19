import { useEffect, useState } from 'react';
import type { EstadoAtualizacao } from '@shared/desktop-api';
import { obterPonte } from '../ponte';

/**
 * O estado do updater, vivo: primeira leitura + assinatura das mudanças.
 *
 * `null` enquanto a primeira resposta não voltou — e "não sei" nunca deve
 * bloquear nada: quem usa este hook para travar botão só trava em estado
 * afirmativo ('pronta'), senão todo mundo esperaria o updater para trabalhar.
 */
export function useEstadoAtualizacao(): EstadoAtualizacao | null {
  const ponte = obterPonte();
  const [estado, setEstado] = useState<EstadoAtualizacao | null>(null);

  useEffect(() => {
    if (!ponte) return undefined;
    void ponte.obterEstadoAtualizacao().then(setEstado).catch(() => undefined);
    return ponte.aoMudarAtualizacao(setEstado);
  }, [ponte]);

  return estado;
}
