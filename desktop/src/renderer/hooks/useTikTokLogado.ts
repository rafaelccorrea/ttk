import { useEffect, useState } from 'react';
import { obterPonte } from '../ponte';

/**
 * Se há alguém logado no TikTok na metade esquerda da janela.
 *
 * `null` enquanto a primeira leitura não voltou, e a distinção importa: quem
 * trata "ainda não sei" como "não está logado" pisca um aviso de "entre no
 * TikTok" na abertura de todo mundo que JÁ está logado, e um aviso que mente
 * uma vez por abertura é um aviso que ninguém lê na hora que ele é verdade.
 *
 * A assinatura existe porque o login acontece FORA do painel: a pessoa digita
 * na view do TikTok, e quem percebe é o processo principal, olhando o cookie de
 * sessão da partição.
 */
export function useTikTokLogado(): boolean | null {
  const ponte = obterPonte();
  const [logado, setLogado] = useState<boolean | null>(null);

  useEffect(() => {
    if (!ponte) return undefined;
    void ponte.tiktokLogado().then(setLogado).catch(() => setLogado(null));
    return ponte.aoMudarTikTok(setLogado);
  }, [ponte]);

  return logado;
}
