import {
  existsSync,
  mkdirSync,
  copyFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Põe o instalador do Copiloto dentro do `dist`, em `/app`.
 *
 * POR QUE ISTO EXISTE. O deploy do frontend é manual: o `dist` inteiro sobe para
 * o `public_html` da Hostinger. O app de desktop é distribuído pelo MESMO
 * domínio — `pikpokviral.com.br/app` é de onde o botão baixa o instalador e de
 * onde o `electron-updater` lê o `latest.yml` para saber se há versão nova (ver
 * `desktop/README.md`). Duas subidas separadas, feitas à mão, é uma que vai ser
 * esquecida: o dia em que o `.exe` novo sobe e o `latest.yml` não (ou o
 * contrário) é o dia em que o updater de todo mundo aponta para um arquivo que
 * não existe. Copiando aqui, `npm run build` produz um `dist` que já é o site
 * completo, e subir é um passo só.
 *
 * QUANDO NÃO HÁ INSTALADOR, este script AVISA e deixa passar — não quebra o
 * build. Um deploy de frontend não pode ficar refém de o Windows ter rodado
 * `npm run dist` no `desktop/`. E o silêncio não custa caro: como a subida é por
 * cópia (não apaga o que já está no servidor), um `dist` sem `/app` deixa a
 * pasta que já está publicada intacta.
 */

const aqui = dirname(fileURLToPath(import.meta.url));
const origem = join(aqui, '..', '..', 'desktop', 'release');
const destino = join(aqui, '..', 'dist', 'app');

/** O que vai junto: o instalador e o manifesto que o updater lê. */
const ehInstalador = (nome) => /^PikPok-Copiloto-Setup-.+\.exe$/.test(nome);
const ehManifesto = (nome) => nome === 'latest.yml';

function main() {
  if (!existsSync(origem)) {
    avisar('a pasta desktop/release não existe');
    return;
  }

  const candidatos = readdirSync(origem).filter(
    (nome) => ehInstalador(nome) || ehManifesto(nome),
  );
  const instalador = candidatos.find(ehInstalador);
  const manifesto = candidatos.find(ehManifesto);

  /*
   * Os dois, ou nenhum. Copiar só o `latest.yml` publicaria o anúncio de uma
   * versão cujo arquivo não subiu — que é exatamente a falha que este script
   * existe para impedir, só que automatizada.
   */
  if (!instalador || !manifesto) {
    avisar(
      !instalador
        ? 'não achei o instalador em desktop/release'
        : 'achei o instalador mas não o latest.yml',
    );
    return;
  }

  mkdirSync(destino, { recursive: true });
  for (const nome of [instalador, manifesto]) {
    copyFileSync(join(origem, nome), join(destino, nome));
  }

  /*
   * O manifesto que o SITE lê (o `latest.yml` é o que o UPDATER lê). A versão
   * sai do nome do arquivo que acabou de ser copiado — a mesma origem do `.exe`
   * que o botão baixa —, então o link e o número que aparecem na página não têm
   * como divergir do instalador publicado. Antes isso vinha de envs no backend
   * (`DESKTOP_DOWNLOAD_WINDOWS`/`DESKTOP_VERSION`), que precisavam ser editadas
   * à mão a cada release e viviam esquecidas apontando para a versão anterior.
   */
  const versao =
    instalador.match(/^PikPok-Copiloto-Setup-(.+)\.exe$/)?.[1] ?? null;
  writeFileSync(
    join(destino, 'download.json'),
    JSON.stringify(
      {
        disponivel: true,
        versao,
        windows: `/app/${instalador}`,
        mac: null,
        // Instalador sem assinatura de código: a página avisa do SmartScreen.
        // Quando houver certificado, mudar aqui (e nada mais).
        assinado: false,
      },
      null,
      2,
    ),
  );

  const mb = (statSync(join(destino, instalador)).size / 1024 / 1024).toFixed(1);
  console.log(
    `dist/app: ${instalador} (${mb}MB) + latest.yml + download.json prontos para subir.`,
  );
}

function avisar(motivo) {
  console.warn(
    `\n  AVISO: o dist saiu SEM o app de desktop — ${motivo}.\n` +
      '  O site funciona, mas o download do Copiloto não vai junto nesta subida.\n' +
      '  Para incluir: cd desktop && npm run dist, e rode este build de novo.\n',
  );
}

main();
