/**
 * Login único no TikTok Shop (Seller/Affiliate Center) para habilitar a
 * coleta de PRODUTOS REAIS.
 *
 * Uso:  npm run shop:login
 *
 * Por que existe: o catálogo público do TikTok Shop (tiktok.com/shop) está
 * atrás de captcha, e o Creative Center não expõe mais ranking de produtos.
 * A única fonte confiável e acessível é a área logada do Shop, onde os
 * produtos vêm com nome, preço, comissão e vendas de verdade.
 *
 * Abre um Chromium visível — faça login normalmente com a sua conta (resolva
 * você mesmo qualquer verificação). Quando a área logada carregar, o script
 * salva a sessão em backend/shop-session.json (gitignored) e fecha.
 */
const path = require('path');

const STATE_FILE = path.join(__dirname, '..', 'shop-session.json');
const START_URL = 'https://seller-br.tiktok.com/';

(async () => {
  const { chromium } = require('playwright');
  const browser = await chromium.launch({
    headless: false,
    args: ['--disable-blink-features=AutomationControlled'],
  });
  const context = await browser.newContext({
    locale: 'pt-BR',
    viewport: { width: 1280, height: 860 },
  });
  const page = await context.newPage();
  await page.goto(START_URL, {
    waitUntil: 'domcontentloaded',
    timeout: 120_000,
  });

  console.log('');
  console.log('>> Faça login no TikTok Shop na janela que abriu.');
  console.log('>> Vale conta de vendedor OU de afiliado/criador.');
  console.log('>> Detecto o login automaticamente e salvo a sessão.');
  console.log('');

  // Considera logado quando existe cookie de sessão no domínio do Shop e a
  // URL já não é a tela de login/registro. Checa a cada 4s, até 10 min.
  const deadline = Date.now() + 10 * 60_000;
  let logged = false;
  while (Date.now() < deadline) {
    const cookies = await context.cookies();
    const hasSession = cookies.some(
      (c) =>
        /sessionid|sid_tt|passport/i.test(c.name) &&
        /tiktok/i.test(c.domain) &&
        c.value.length > 8,
    );
    const url = page.url();
    const onLoginScreen = /login|register|account\/(register|login)/i.test(url);
    if (hasSession && !onLoginScreen) {
      logged = true;
      break;
    }
    await page.waitForTimeout(4000);
  }

  if (!logged) {
    console.error('Tempo esgotado sem detectar login. Rode de novo.');
    await browser.close();
    process.exit(1);
  }

  await context.storageState({ path: STATE_FILE });
  console.log(`Sessão salva em ${STATE_FILE}`);

  // Login não basta: a conta precisa estar habilitada como vendedor ou
  // afiliado. Sem isso, nenhuma tela de produto abre — melhor avisar agora
  // do que descobrir depois com o catálogo vazio.
  console.log('');
  console.log('Verificando o que esta conta libera...');
  const checks = [
    { name: 'Seller Center (produtos da sua loja)', url: 'https://seller-br.tiktok.com/product/manage' },
    { name: 'Afiliados (catálogo de todas as lojas)', url: 'https://affiliate.tiktok.com/connection/creator' },
  ];
  const unlocked = [];
  for (const check of checks) {
    try {
      await page.goto(check.url, { waitUntil: 'domcontentloaded', timeout: 45_000 });
      await page.waitForTimeout(6000);
      const url = page.url();
      const blocked =
        /settle\/verification|errorpage|login|register/i.test(url) ||
        /quebra-cabeça|Verify to continue|Algo deu errado/i.test(
          await page.evaluate(() => document.body.innerText.slice(0, 400)),
        );
      console.log(`  ${blocked ? '[X]' : '[OK]'} ${check.name}`);
      if (!blocked) unlocked.push(check.name);
    } catch {
      console.log(`  [X] ${check.name} (falhou ao abrir)`);
    }
  }

  console.log('');
  if (unlocked.length === 0) {
    console.log('Nenhuma área de produto liberada para esta conta.');
    console.log('Para coletar produtos reais é preciso UMA destas:');
    console.log('  1) Concluir o cadastro de vendedor em seller-br.tiktok.com');
    console.log('  2) Ser aprovado no programa de afiliados do TikTok Shop');
    console.log('A sessão foi salva mesmo assim: assim que a conta for');
    console.log('habilitada, a coleta passa a funcionar sem novo login.');
  } else {
    console.log('Áreas liberadas:', unlocked.join(' e '));
  }
  await browser.close();
})();
