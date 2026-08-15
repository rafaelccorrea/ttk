/**
 * Captura as telas reais do app para a landing page.
 *
 * Pré-requisitos: backend em :3000 (com ALLOW_DEV_LOGIN=true) e frontend dev
 * rodando. Uso:
 *
 *   node scripts/capture-screens.mjs [urlDoFront]
 *
 * As imagens vão para frontend/public/screens/*.png (2x, prontas para a landing).
 */
import { chromium } from '../../backend/node_modules/playwright/index.mjs';
import { mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(here, '..', 'public', 'screens');
const BASE = process.argv[2] ?? 'http://localhost:5174';
const EMAIL = process.env.TEST_USER_EMAIL ?? 'teste@pikpok.app';

const SHOTS = [
  { file: 'dashboard', path: '/dashboard' },
  { file: 'produtos', path: '/produtos' },
  { file: 'videos', path: '/videos' },
  { file: 'criadores', path: '/criadores' },
  { file: 'tendencias', path: '/tendencias' },
  { file: 'estudio', path: '/estudio' },
  { file: 'prompts', path: '/prompts' },
  { file: 'analisar', path: '/analisar' },
  { file: 'multiplicador', path: '/multiplicador' },
];

const token = await fetch(`${BASE}/api/v1/auth/dev-login`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: EMAIL }),
}).then((r) => r.json());

if (!token?.accessToken) throw new Error('dev-login não retornou accessToken');

await mkdir(OUT, { recursive: true });

const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  deviceScaleFactor: 2,
  locale: 'pt-BR',
});
await context.addInitScript(
  ([accessToken, email]) => {
    localStorage.setItem('pikpok.accessToken', accessToken);
    localStorage.setItem('pikpok.email', email);
  },
  [token.accessToken, EMAIL],
);

const page = await context.newPage();
for (const shot of SHOTS) {
  await page.goto(`${BASE}${shot.path}`, { waitUntil: 'networkidle', timeout: 60_000 });
  // Espera o splash de carregamento sair — senão o print pega a tela vazia.
  await page
    .waitForFunction(() => !document.body.innerText.includes('Carregando'), null, { timeout: 30_000 })
    .catch(() => {});
  await page.waitForLoadState('networkidle').catch(() => {});
  // Esconde o widget de chat flutuante, que polui o print.
  await page.addStyleTag({
    content: '[class*="MuiFab-root"], [aria-label*="chat" i] { display: none !important; }',
  });
  // Tira da imagem o que é da conta de teste (saldo de créditos e e-mail),
  // que não diz nada sobre o produto e ainda expõe dado de usuário.
  await page.evaluate(() => {
    for (const el of document.querySelectorAll('*')) {
      const text = el.textContent ?? '';
      if (el.children.length === 0 && /créditos$/.test(text.trim())) {
        el.closest('.MuiChip-root, [class*="MuiChip"]')?.remove();
      }
    }
    for (const el of document.querySelectorAll('*')) {
      if (el.children.length === 0 && el.textContent?.includes('@pikpok.app')) {
        el.textContent = 'você@pikpok.app';
      }
    }
  });
  await page.waitForTimeout(1200);
  // JPEG a 2x: nitidez de retina com ~1/4 do peso do PNG na landing.
  await page.screenshot({ path: resolve(OUT, `${shot.file}.jpg`), type: 'jpeg', quality: 88 });
  console.log(`✓ ${shot.file}.jpg`);
}

await browser.close();
