/**
 * Abre o cadastro de vendedor do TikTok Shop na sua sessão já logada.
 *
 * Uso:  npm run shop:register
 *
 * O preenchimento é SEU (documento, dados da empresa/pessoa e conta bancária).
 * Quando terminar e a conta for aprovada, rode `npm run shop:login` de novo
 * para atualizar a sessão — aí o PikPok passa a enxergar a sua loja real.
 *
 * A janela fica aberta até você fechá-la.
 */
const path = require('path');

const STATE_FILE = path.join(__dirname, '..', 'shop-session.json');

(async () => {
  const { chromium } = require('playwright');
  const fs = require('fs');
  const browser = await chromium.launch({
    headless: false,
    args: ['--disable-blink-features=AutomationControlled'],
  });
  const context = await browser.newContext({
    locale: 'pt-BR',
    viewport: { width: 1280, height: 900 },
    ...(fs.existsSync(STATE_FILE) ? { storageState: STATE_FILE } : {}),
  });
  const page = await context.newPage();
  await page.goto('https://seller-br.tiktok.com/settle/verification', {
    waitUntil: 'domcontentloaded',
    timeout: 120_000,
  });

  console.log('');
  console.log('>> Cadastro de vendedor aberto na janela do navegador.');
  console.log('>> Tenha em mãos: CPF ou CNPJ, endereço, e conta bancária.');
  console.log('>> O preenchimento é seu — eu não preencho dados pessoais.');
  console.log('>> Feche a janela quando terminar (a sessão é salva no fim).');
  console.log('');

  // Mantém aberto até o usuário fechar; salva a sessão atualizada ao sair.
  await page.waitForEvent('close', { timeout: 0 }).catch(() => undefined);
  try {
    await context.storageState({ path: STATE_FILE });
    console.log('Sessão atualizada salva.');
  } catch {
    console.log('Janela fechada.');
  }
  await browser.close().catch(() => undefined);
})();
