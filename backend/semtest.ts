import 'dotenv/config';
import { readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { HiggsfieldCliService } from './src/modules/videogen/higgsfield-cli.service';

const alvo = join(tmpdir(), 'pikpok-higgsfield', 'credentials.json');
rmSync(alvo, { force: true });
console.log('antes: arquivo existe?', existsSync(alvo));

const conteudo = readFileSync('C:/Users/rafae/.config/higgsfield/credentials.json', 'utf8');
const env: Record<string, string | undefined> = { ...process.env, HIGGSFIELD_CREDENTIALS_JSON: conteudo };
delete env.HIGGSFIELD_CREDENTIALS_PATH;

const cli = new HiggsfieldCliService({ get: (k: string) => env[k] } as never);
console.log('depois: arquivo existe?', existsSync(alvo));
console.log('isConfigured:', cli.isConfigured);

(async () => {
  console.log('sentinela com credencial semeada:', JSON.stringify(await cli.verificarAutenticacao()));
  rmSync(join(tmpdir(), 'pikpok-higgsfield'), { recursive: true, force: true });
  console.log('limpo.');
})().catch(e => { console.error('FALHOU:', e?.message ?? e); process.exit(1); });
