import { beforeEach, describe, expect, it } from 'vitest';
import { Wallet } from '@/services/billing.service';
import { deveMostrar } from './WelcomeModal';

/**
 * O modal de boas-vindas aparece UMA vez, e só para quem ainda tem o presente
 * inteiro. As regras aqui são as que o vendedor pediu: nunca para assinante,
 * nunca para quem já gastou crédito ou já usou o vídeo grátis, e "perguntar
 * depois" não conta como visto.
 */
const EMAIL = 'novo@loja.com';

function carteira(extra: Partial<Wallet> = {}): Wallet {
  return {
    credits: 25,
    plan: 'free',
    prices: {},
    freeSample: { active: true, products: 20, videos: 10, refreshDays: 7 },
    sampleVideo: { available: true, credits: 60 },
    liveCopilot: { minutes: 0, trialMinutes: 10, trialAvailable: true, packs: [] },
    history: [
      {
        id: '1',
        amount: 25,
        balanceAfter: 25,
        kind: 'signup_bonus',
        createdAt: '2026-08-23T00:00:00Z',
      },
    ],
    ...extra,
  };
}

beforeEach(() => localStorage.clear());

describe('modal de boas-vindas — quando mostrar', () => {
  it('mostra para a conta gratuita nova, com tudo intacto', () => {
    expect(deveMostrar(carteira(), EMAIL)).toBe(true);
  });

  it('não mostra para assinante', () => {
    expect(
      deveMostrar(
        carteira({ plan: 'pro', freeSample: { active: false, products: 0, videos: 0, refreshDays: 0 } }),
        EMAIL,
      ),
    ).toBe(false);
    // Plano pago com freeSample marcado por engano: o plano manda.
    expect(deveMostrar(carteira({ plan: 'essencial' }), EMAIL)).toBe(false);
  });

  it('não mostra para quem já usou o vídeo grátis', () => {
    expect(deveMostrar(carteira({ sampleVideo: { available: false, credits: 60 } }), EMAIL)).toBe(
      false,
    );
  });

  it('não mostra para quem já gastou crédito', () => {
    const h = carteira().history;
    expect(
      deveMostrar(
        carteira({
          credits: 17,
          history: [
            { id: '2', amount: -8, balanceAfter: 17, kind: 'spend', action: 'script', createdAt: '' },
            ...h,
          ],
        }),
        EMAIL,
      ),
    ).toBe(false);
    expect(deveMostrar(carteira({ credits: 0 }), EMAIL)).toBe(false);
  });

  it('mostra uma vez só: depois de "entendi", não volta', () => {
    localStorage.setItem(`pikpok.boas-vindas:${EMAIL}`, '1');
    expect(deveMostrar(carteira(), EMAIL)).toBe(false);
    // Outra conta no mesmo navegador tem o seu próprio "já vi".
    expect(deveMostrar(carteira(), 'outra@loja.com')).toBe(true);
  });

  it('backend antigo, sem `sampleVideo`: ainda mostra os outros presentes', () => {
    expect(deveMostrar(carteira({ sampleVideo: undefined }), EMAIL)).toBe(true);
  });
});
