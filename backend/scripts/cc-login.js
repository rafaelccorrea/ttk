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

  // Espera o login valer NO Creative Center (user/info code=0), não só um
  // cookie do tiktok.com. Checa a cada 4s, até 8 min.
  const deadline = Date.now() + 8 * 60_000;
  let logged = false;
  while (Date.now() < deadline) {
    logged = await page
      .evaluate(async () => {
        try {
          const res = await fetch(
            'https://ads.tiktok.com/creative_radar_api/v1/user/info',
            { credentials: 'include', headers: { accept: 'application/json' } },
          );
          const body = await res.json();
          return body?.code === 0;
        } catch {
          return false;
        }
      })
      .catch(() => false);
    if (logged) break;
    await page.waitForTimeout(4000);
  }

  if (!logged) {
    console.error('Tempo esgotado sem detectar login. Rode de novo.');
    await browser.close();
    process.exit(1);
  }

  await context.storageState({ path: STATE_FILE });
  console.log(`Sessão salva em ${STATE_FILE}`);

  // Conta dos EUA trava as abas de vídeo/criador na região US. Conferimos a
  // região e o idioma logo após o login para não descobrir depois.
  console.log('');
  console.log('Verificando a região da conta...');
  await page
    .goto('https://ads.tiktok.com/creative/creativeCenter/trends/video?period=7', {
      waitUntil: 'domcontentloaded',
      timeout: 60_000,
    })
    .catch(() => undefined);
  await page.waitForTimeout(8000);
  const finalUrl = page.url();
  const bodyText = await page
    .evaluate(() => document.body.innerText.slice(0, 400))
    .catch(() => '');
  const regionInUrl = finalUrl.match(/region=([A-Z]{2})/)?.[1] ?? '(não informada)';
  const mentionsBrazil = /Brasil|Brazil/.test(bodyText);

  console.log(`  Região da aba de vídeos: ${regionInUrl}`);
  console.log(`  Página menciona Brasil: ${mentionsBrazil ? 'sim' : 'não'}`);
  if (regionInUrl === 'BR' || mentionsBrazil) {
    console.log('  [OK] Conta com acesso ao Brasil — vídeos e criadores BR liberados.');
  } else {
    console.log('  [!] A aba de vídeos está travada na região ' + regionInUrl + '.');
    console.log('      Se esta conta for dos EUA, saia dela e entre com uma conta BR.');
    console.log('      A coleta de vídeos BR pelo Top Ads funciona de qualquer forma.');
  }
  await browser.close();
})();
