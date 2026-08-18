import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AppModule } from '../app.module';
import { IngestionService } from '../modules/ingestion/ingestion.service';
import { IngestionSetting } from '../modules/ingestion/entities/ingestion-setting.entity';
import { Product } from '../modules/products/entities/product.entity';

/**
 * Gasta TODA a cota que sobrou do mês no EchoTik, de uma vez — `npm run zerar:cota`.
 *
 * POR QUE ISTO EXISTE
 * -------------------
 * O `atualizar.ts` obedece ao ritmo mensal: o `openApiAllowance()` divide o que
 * resta pelas execuções que ainda faltam até o dia 30, e com um teto de 500 e um
 * cron de 3x ao dia isso dá cinco requisições por execução — o suficiente para
 * uma camada e mais nada. Esse ritmo é certo para o piloto automático e errado
 * quando a decisão é humana: "quero converter o que sobrou de cota em catálogo,
 * hoje" é exatamente o caso que o marcapasso atrapalha.
 *
 * Então este script é à parte, e não uma flag do outro: ele NÃO paga o pedágio
 * do rateio, trabalha em lotes explícitos e para sozinho quando a cota zera ou
 * quando a coleta deixa de render.
 *
 * O QUE ELE PERSEGUE
 * ------------------
 * A prioridade é o alvo 1 do `docs/ECHOTIK.md`: **produtos que ainda não temos**.
 * Descoberta varre categoria a categoria — é o que dá nicho (Pet Shop,
 * Automotivo) em vez de repetir Beleza e Eletrônicos — e o que se mede a cada
 * lote é quantos vieram INÉDITOS. Quando o rendimento cai a zero em dois lotes
 * seguidos, insistir vira queimar cota para reencontrar o que já está no banco,
 * e o script encerra mesmo com saldo.
 *
 * TUDO É PERSISTIDO. Requisição paga não se joga fora: cada produto entra pelo
 * mesmo caminho da ingestão normal (`upsertProduct` + métrica diária) e cada
 * resposta fica no arquivo bruto. Ver `docs/ECHOTIK.md`, seção 10.
 *
 *   npm run zerar:cota                 # gasta tudo o que restar
 *   npm run zerar:cota -- --teto=50    # gasta no máximo 50 requisições
 *   npm run zerar:cota -- --lote=20    # tamanho do lote (padrão 25)
 *   npm run zerar:cota -- --paginas=5  # páginas por categoria (padrão 3)
 */

const log = new Logger('ZerarCota');

const arg = (nome: string, padrao: number): number => {
  const bruto = process.argv.find((a) => a.startsWith(`--${nome}=`))?.split('=')[1];
  const n = Number(bruto);
  return Number.isFinite(n) && n > 0 ? n : padrao;
};

/** Teto opcional. Zero significa "o que estiver sobrando no mês". */
const TETO = arg('teto', 0);
/**
 * Tamanho do lote.
 *
 * Lotes existem para que o script possa DESISTIR no meio: a cada rodada ele
 * confere quantos produtos eram inéditos e decide se continua. Um lote único de
 * 237 requisições não daria essa chance — descobriria no fim que as últimas
 * cento e poucas trouxeram repetido.
 */
const LOTE = arg('lote', 25);
const PAGINAS = arg('paginas', 3);

/** Quantos lotes seguidos sem produto novo antes de parar. */
const LOTES_SECOS_ATE_PARAR = 2;

async function main(): Promise<void> {
  const inicio = Date.now();
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn', 'log'],
  });

  const ingestion = app.get(IngestionService);
  const settings = app.get<Repository<IngestionSetting>>(
    getRepositoryToken(IngestionSetting),
  );
  const produtos = app.get<Repository<Product>>(getRepositoryToken(Product));

  const config = await settings.findOne({ where: {} });
  if (!config) {
    log.error('Sem linha em ingestion_settings — nada a fazer.');
    await app.close();
    return;
  }

  const semTeto = config.apiMonthlyBudget <= 0;
  const restanteMes = semTeto
    ? Number.MAX_SAFE_INTEGER
    : config.apiMonthlyBudget - config.apiRequestsUsed;
  let restante = TETO > 0 ? Math.min(TETO, restanteMes) : restanteMes;

  if (restante <= 0) {
    log.log(
      `Cota já zerada: ${config.apiRequestsUsed}/${config.apiMonthlyBudget} em ${config.apiMonthKey}.`,
    );
    await app.close();
    return;
  }

  const catalogoAntes = await produtos.count();
  log.log(
    `Cota em ${config.apiMonthKey}: ${config.apiRequestsUsed}/${config.apiMonthlyBudget} · ` +
      `vou gastar até ${restante} em lotes de ${LOTE} · catálogo hoje: ${catalogoAntes}`,
  );

  let gastas = 0;
  let novosTotal = 0;
  let secos = 0;
  let lote = 0;

  while (restante > 0 && secos < LOTES_SECOS_ATE_PARAR) {
    lote += 1;
    const tamanho = Math.min(LOTE, restante);

    const r = await ingestion.descobrirNovos(PAGINAS, tamanho);

    /*
     * O contador do mês é atualizado AQUI porque o `descobrirNovos` não fecha a
     * janela de cota — ele foi feito para a rota administrativa, que informa o
     * custo na resposta e deixa a contabilidade para quem chamou. Sem esta
     * escrita, o `atualizar.ts` continuaria calculando o rateio como se as
     * requisições deste script não tivessem existido, e o mês estouraria sem
     * ninguém ver.
     */
    if (!semTeto && r.requisicoes > 0) {
      const atual = await settings.findOne({ where: { id: config.id } });
      if (atual) {
        atual.apiRequestsUsed += r.requisicoes;
        await settings.save(atual);
      }
    }

    gastas += r.requisicoes;
    novosTotal += r.novos;
    restante -= r.requisicoes;

    log.log(
      `Lote ${lote}: ${r.requisicoes} requisições · ${r.vistos} produtos vistos · ` +
        `${r.novos} INÉDITOS · restam ${Math.max(0, restante)}`,
    );

    // Fornecedor parou de responder (cota estourada do lado deles, disjuntor
    // armado, rede): insistir só produz espera.
    if (r.requisicoes === 0) {
      log.warn('O lote não consumiu requisição alguma — encerrando.');
      break;
    }
    secos = r.novos === 0 ? secos + 1 : 0;
  }

  if (secos >= LOTES_SECOS_ATE_PARAR) {
    log.warn(
      `${LOTES_SECOS_ATE_PARAR} lotes seguidos sem produto novo: o resto da cota ` +
        `foi preservado em vez de repetir o que já está no catálogo.`,
    );
  }

  const catalogoDepois = await produtos.count();
  const final = await settings.findOne({ where: { id: config.id } });
  log.log('─────────────────────────────────────────────');
  log.log(`requisições gastas   ${gastas}`);
  log.log(`produtos inéditos    ${novosTotal}`);
  log.log(`catálogo             ${catalogoAntes} → ${catalogoDepois}`);
  if (final && !semTeto) {
    log.log(
      `cota do mês          ${final.apiRequestsUsed}/${final.apiMonthlyBudget} ` +
        `(restam ${Math.max(0, final.apiMonthlyBudget - final.apiRequestsUsed)})`,
    );
  }
  log.log(`Concluído em ${Math.round((Date.now() - inicio) / 1000)}s`);

  await app.close();
}

main().catch((erro) => {
  log.error(`Falhou: ${(erro as Error).message}`);
  process.exit(1);
});
