/**
 * Login único no TikTok Creative Center para habilitar o scraping de produtos.
 *
 * Uso:  npm run cc:login
 *
 * Abre um Chromium visível em ads.tiktok.com — faça login normalmente (conta
 * TikTok/e-mail; resolva você mesmo qualquer verificação). Quando a página
 * logada carregar, o script salva os cookies em backend/cc-session.json
 * (gitignored) e fecha. A ingestão passa a usar essa sessão automaticamente.
 * A sessão dura semanas; se expirar, rode de novo.
 */
const path = require('path');

const STATE_FILE = path.join(__dirname, '..', 'cc-session.json');

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
  await page.goto(
    'https://ads.tiktok.com/business/creativecenter/inspiration/popular/product/pc/pt',
    { waitUntil: 'domcontentloaded', timeout: 120_000 },
  );

  console.log('');
  console.log('>> Faça login na janela do navegador que abriu.');
  console.log('>> Detecto o login automaticamente e salvo a sessão.');
  console.log('');

  // Espera até existir cookie de sessão logada (checa a cada 3s, até 5 min).
  const deadline = Date.now() + 5 * 60_000;
  let logged = false;
  while (Date.now() < deadline) {
    const cookies = await context.cookies('https://ads.tiktok.com');
    logged = cookies.some((c) => /sessionid/i.test(c.name) && c.value.length > 8);
    if (logged) break;
    await page.waitForTimeout(3000);
  }

  if (!logged) {
    console.error('Tempo esgotado sem detectar login. Rode de novo.');
    await browser.close();
    process.exit(1);
  }

  await context.storageState({ path: STATE_FILE });
  console.log(`Sessão salva em ${STATE_FILE}`);
  console.log('Pronto! A ingestão de produtos vai usar essa sessão.');
  await browser.close();
})();
