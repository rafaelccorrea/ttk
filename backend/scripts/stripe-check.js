/* eslint-disable */
/**
 * Confere se os prices da Stripe apontados por STRIPE_PRICE_* cobram EXATAMENTE
 * o que `billing.config.ts` anuncia. Somente leitura — não cria nem altera nada.
 *
 * Por que existe: os `price IDs` em env vencem o `priceBrl` do config no
 * checkout (ver `stripe.service.ts` → `envPrice`). Mudar o preço no código e
 * esquecer a Stripe faz o site anunciar um valor e o cartão ser cobrado por
 * outro — o pior bug possível, porque quem descobre é o cliente na fatura.
 *
 * Uso: `cd backend && node scripts/stripe-check.js` (lê o .env do backend).
 * Sai com código 1 se houver divergência — dá para pendurar no CI.
 */
require('dotenv').config();
require('ts-node/register/transpile-only');
const Stripe = require('stripe');
const {
  PLANS,
  CREDIT_PACKS,
  LIVE_HOUR_PACKS,
} = require('../src/modules/billing/billing.config');

const chave = process.env.STRIPE_SECRET_KEY;
if (!chave) {
  console.error('STRIPE_SECRET_KEY ausente.');
  process.exit(2);
}
const stripe = new Stripe(chave);

/** (suffix do env, valor esperado em BRL, recorrência esperada) */
const esperados = [];
for (const p of PLANS) {
  esperados.push([`${p.id}-month`, p.priceBrl, 'month']);
  if (p.annual) esperados.push([`${p.id}-year`, p.annual.priceBrl, 'year']);
}
for (const p of CREDIT_PACKS) esperados.push([p.id, p.priceBrl, null]);
for (const p of LIVE_HOUR_PACKS) esperados.push([p.id, p.priceBrl, null]);

const envKey = (suffix) =>
  `STRIPE_PRICE_${suffix.toUpperCase().replace(/-/g, '_')}`;

(async () => {
  let divergencias = 0;
  console.log(
    `Stripe ${chave.startsWith('sk_live') ? 'LIVE' : 'TEST'} × billing.config`,
  );
  for (const [suffix, valor, recorrencia] of esperados) {
    const id = process.env[envKey(suffix)];
    if (!id) {
      console.log(`--      ${suffix.padEnd(18)} sem ${envKey(suffix)} (checkout usa price_data do config)`);
      continue;
    }
    try {
      const price = await stripe.prices.retrieve(id, { expand: ['product'] });
      const cobrado = price.unit_amount / 100;
      const intervalo = price.recurring ? price.recurring.interval : null;
      const problemas = [];
      if (Math.abs(cobrado - valor) >= 0.005) problemas.push(`valor ${cobrado.toFixed(2)} ≠ ${valor.toFixed(2)}`);
      if (intervalo !== recorrencia) problemas.push(`recorrência ${intervalo ?? 'única'} ≠ ${recorrencia ?? 'única'}`);
      if (!price.active) problemas.push('price INATIVO');
      if (price.currency !== 'brl') problemas.push(`moeda ${price.currency}`);
      const status = problemas.length ? 'DIVERGE' : 'OK     ';
      if (problemas.length) divergencias += 1;
      console.log(`${status} ${suffix.padEnd(18)} ${cobrado.toFixed(2).padStart(8)} ${(intervalo ?? 'única').padEnd(6)} ${price.product?.name ?? ''}${problemas.length ? '  ← ' + problemas.join('; ') : ''}`);
    } catch (e) {
      divergencias += 1;
      console.log(`ERRO    ${suffix.padEnd(18)} ${id}: ${e.message}`);
    }
  }
  console.log(divergencias ? `\n${divergencias} divergência(s).` : '\nTudo alinhado.');
  process.exit(divergencias ? 1 : 0);
})();
