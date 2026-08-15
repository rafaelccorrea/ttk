import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { MailService } from '../auth/mail.service';
import { AppUser } from '../users/entities/app-user.entity';
import { StoreOrder } from './entities/store-order.entity';
import { StoreProduct } from './entities/store-product.entity';
import { Store } from './entities/store.entity';

export interface StoreDigest {
  storeName: string;
  lateOrders: Array<{ externalId: string; shipBy: Date | null }>;
  lateCount: number;
  lowStock: Array<{ sku: string; title: string; stock: number | null }>;
  lowStockCount: number;
}

/** Quantos exemplos entram no corpo do e-mail antes de virar "e mais N". */
const SAMPLE_SIZE = 5;

/**
 * Aviso diário do que exige ação na loja.
 *
 * Atraso de envio derruba a reputação no TikTok Shop e ruptura de estoque mata
 * venda que já estava acontecendo — as duas coisas o seller precisa saber sem
 * ter que lembrar de abrir a plataforma.
 */
@Injectable()
export class StoresAlertsService {
  private readonly logger = new Logger(StoresAlertsService.name);

  constructor(
    private readonly mail: MailService,
    private readonly config: ConfigService,
    @InjectRepository(Store)
    private readonly stores: Repository<Store>,
    @InjectRepository(StoreOrder)
    private readonly orders: Repository<StoreOrder>,
    @InjectRepository(StoreProduct)
    private readonly products: Repository<StoreProduct>,
    @InjectRepository(AppUser)
    private readonly users: Repository<AppUser>,
  ) {}

  @Cron('0 0 9 * * *', {
    name: 'store-daily-alerts',
    timeZone: 'America/Sao_Paulo',
  })
  async runDailyAlerts(): Promise<{ sent: number; skipped: number }> {
    if (this.config.get('STORE_ALERTS_ENABLED') === 'false') {
      return { sent: 0, skipped: 0 };
    }

    const stores = await this.stores.find();
    let sent = 0;
    let skipped = 0;

    for (const store of stores) {
      try {
        const digest = await this.buildDigest(store);
        if (!digest) {
          skipped += 1;
          continue;
        }

        const user = await this.users.findOneBy({ id: store.userId });
        if (!user?.email) {
          skipped += 1;
          continue;
        }

        await this.mail.send({
          to: user.email,
          subject: this.subject(digest),
          text: this.text(digest),
          body: this.html(digest),
          footer:
            'Você recebe este aviso porque tem uma loja cadastrada na PikPok.',
        });
        sent += 1;
      } catch (error) {
        // Uma loja com problema não pode impedir o aviso das outras.
        this.logger.error(
          `Falha ao enviar alerta da loja ${store.id}: ${
            error instanceof Error ? error.message : error
          }`,
        );
        skipped += 1;
      }
    }

    this.logger.log(`Alertas de loja: ${sent} enviados, ${skipped} ignorados.`);
    return { sent, skipped };
  }

  /** Devolve null quando não há nada que mereça um e-mail. */
  async buildDigest(store: Store): Promise<StoreDigest | null> {
    const late = await this.orders.find({
      where: { storeId: store.id, stage: 'pendente' },
      order: { shipBy: 'ASC' },
    });
    const now = Date.now();
    const lateOrders = late.filter(
      (order) => order.shipBy !== null && order.shipBy.getTime() < now,
    );

    const products = await this.products.find({
      where: { storeId: store.id },
      order: { stock: 'ASC' },
    });
    const lowStock = products.filter(
      (product) =>
        product.stockAlert !== null &&
        product.stock !== null &&
        product.stock <= product.stockAlert,
    );

    if (lateOrders.length === 0 && lowStock.length === 0) return null;

    return {
      storeName: store.name,
      lateCount: lateOrders.length,
      lateOrders: lateOrders.slice(0, SAMPLE_SIZE).map((order) => ({
        externalId: order.externalId,
        shipBy: order.shipBy,
      })),
      lowStockCount: lowStock.length,
      lowStock: lowStock.slice(0, SAMPLE_SIZE).map((product) => ({
        sku: product.sku,
        title: product.title,
        stock: product.stock,
      })),
    };
  }

  // ---------------------------------------------------------------- Conteúdo

  private subject(digest: StoreDigest): string {
    const parts: string[] = [];
    if (digest.lateCount > 0) {
      parts.push(
        `${digest.lateCount} pedido${digest.lateCount > 1 ? 's' : ''} atrasado${
          digest.lateCount > 1 ? 's' : ''
        }`,
      );
    }
    if (digest.lowStockCount > 0) {
      parts.push(`${digest.lowStockCount} SKU em estoque baixo`);
    }
    return `${digest.storeName}: ${parts.join(' e ')}`;
  }

  private text(digest: StoreDigest): string {
    const lines = [`Resumo da loja ${digest.storeName}:`, ''];
    if (digest.lateCount > 0) {
      lines.push(`Pedidos com prazo de envio estourado: ${digest.lateCount}`);
      for (const order of digest.lateOrders) {
        lines.push(`  - ${order.externalId}`);
      }
      lines.push('');
    }
    if (digest.lowStockCount > 0) {
      lines.push(`SKUs no estoque mínimo: ${digest.lowStockCount}`);
      for (const product of digest.lowStock) {
        lines.push(`  - ${product.sku} (${product.stock} un.)`);
      }
    }
    return lines.join('\n');
  }

  private html(digest: StoreDigest): string {
    const appUrl = this.config.get('APP_URL', 'https://pikpok.app');
    const sections: string[] = [
      `<h2 style="font-size:18px;margin:0 0 16px">Resumo de ${escapeHtml(digest.storeName)}</h2>`,
    ];

    if (digest.lateCount > 0) {
      sections.push(`
        <div style="background:#fef2f2;border-radius:10px;padding:16px;margin:0 0 16px">
          <strong style="color:#dc2626">${digest.lateCount} pedido(s) com prazo de envio estourado</strong>
          <ul style="margin:8px 0 0;padding-left:20px;color:#161823">
            ${digest.lateOrders
              .map((order) => `<li>${escapeHtml(order.externalId)}</li>`)
              .join('')}
          </ul>
          ${
            digest.lateCount > digest.lateOrders.length
              ? `<p style="margin:8px 0 0;color:#73747b;font-size:13px">e mais ${
                  digest.lateCount - digest.lateOrders.length
                }.</p>`
              : ''
          }
        </div>`);
    }

    if (digest.lowStockCount > 0) {
      sections.push(`
        <div style="background:#fffbeb;border-radius:10px;padding:16px;margin:0 0 16px">
          <strong style="color:#b45309">${digest.lowStockCount} SKU(s) no estoque mínimo</strong>
          <ul style="margin:8px 0 0;padding-left:20px;color:#161823">
            ${digest.lowStock
              .map(
                (product) =>
                  `<li>${escapeHtml(product.title)} (${escapeHtml(product.sku)}) — ${product.stock} un.</li>`,
              )
              .join('')}
          </ul>
          ${
            digest.lowStockCount > digest.lowStock.length
              ? `<p style="margin:8px 0 0;color:#73747b;font-size:13px">e mais ${
                  digest.lowStockCount - digest.lowStock.length
                }.</p>`
              : ''
          }
        </div>`);
    }

    sections.push(
      `<a href="${appUrl}/loja" style="display:inline-block;background:#fe2c55;color:#fff;text-decoration:none;font-weight:700;padding:12px 28px;border-radius:10px">Abrir painel da loja</a>`,
    );

    return sections.join('');
  }
}

/** Nome de produto e SKU vêm de planilha do usuário — nunca entram crus no HTML. */
function escapeHtml(value: string): string {
  return value
    .split('&')
    .join('&amp;')
    .split('<')
    .join('&lt;')
    .split('>')
    .join('&gt;')
    .split('"')
    .join('&quot;');
}
