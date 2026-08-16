import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Product } from '../products/entities/product.entity';

/** Um problema encontrado, com exemplos para ir direto ao caso. */
export interface AchadoDaVitrine {
  chave: string;
  titulo: string;
  /** Por que isso derruba a credibilidade de quem está olhando. */
  porque: string;
  quantidade: number;
  /** Acima disto, o achado é considerado grave. */
  limite: number;
  grave: boolean;
  exemplos: string[];
}

/**
 * Auditoria da vitrine — o cético automático.
 *
 * O dado vem de fornecedor: ele pode zerar um campo, mudar o nome de outro,
 * devolver a lista em ordem arbitrária, ou simplesmente não ter o que a gente
 * pediu. Nada disso quebra o servidor, e é justamente por isso que passa: o
 * sintoma aparece na tela, para o usuário, em forma de "produto campeão de
 * vendas com R$ 0,00 em todos os vídeos".
 *
 * Esta auditoria faz, sozinha e sem gastar cota, as perguntas que a gente só
 * estava fazendo quando alguém reclamava. Roda ao fim de cada ingestão e
 * também sob demanda.
 */
@Injectable()
export class VitrineAuditService {
  private readonly logger = new Logger(VitrineAuditService.name);

  constructor(
    @InjectRepository(Product)
    private readonly products: Repository<Product>,
  ) {}

  /** Quantos produtos do topo são inspecionados. É o que aparece primeiro. */
  private readonly TOPO = 50;

  async auditar(): Promise<{
    topo: number;
    achados: AchadoDaVitrine[];
    graves: number;
  }> {
    const achados: AchadoDaVitrine[] = [];

    const topo = `
      SELECT p.id, p.title FROM products p
      WHERE p."isDuplicate" = false
      ORDER BY p."sales30d" DESC
      LIMIT ${this.TOPO}
    `;

    const consulta = async (
      chave: string,
      titulo: string,
      porque: string,
      limite: number,
      sql: string,
    ) => {
      const linhas: Array<{ title: string }> = await this.products.query(sql);
      achados.push({
        chave,
        titulo,
        porque,
        quantidade: linhas.length,
        limite,
        grave: linhas.length > limite,
        exemplos: linhas.slice(0, 3).map((l) => l.title?.slice(0, 60) ?? '—'),
      });
    };

    // 1. O card mudo: item mais vendido sem um único criativo.
    await consulta(
      'topo-sem-video',
      'Produtos do topo sem nenhum vídeo',
      'Produto sem criativo é ficha sem prova: o usuário conclui que o número é inventado.',
      0,
      `SELECT t.title FROM (${topo}) t
       WHERE NOT EXISTS (SELECT 1 FROM videos v WHERE v."productId" = t.id)`,
    );

    // 2. O sintoma que denunciou a ordenação errada da lista de vídeos.
    await consulta(
      'video-sem-receita',
      'Produtos do topo cujos vídeos estão TODOS com receita zero',
      'Vende dezenas de milhares mas nenhum vídeo vendeu nada: ou pegamos os vídeos errados, ou o campo mudou de nome.',
      2,
      `SELECT t.title FROM (${topo}) t
       WHERE EXISTS (SELECT 1 FROM videos v WHERE v."productId" = t.id)
         AND NOT EXISTS (
           SELECT 1 FROM videos v
           WHERE v."productId" = t.id AND v."revenueEstimate"::numeric > 0
         )`,
    );

    // 3. Preço é a primeira coisa que o vendedor procura.
    await consulta(
      'sem-preco',
      'Produtos do topo sem preço',
      'Sem preço não dá para avaliar margem — a ficha perde a função.',
      0,
      `SELECT t.title FROM (${topo}) t
       JOIN products p ON p.id = t.id
       WHERE p.price IS NULL OR p.price::numeric = 0`,
    );

    // 4. Card sem foto parece produto que não existe.
    await consulta(
      'sem-imagem',
      'Produtos do topo sem imagem',
      'Card sem foto passa a impressão de catálogo abandonado.',
      2,
      `SELECT t.title FROM (${topo}) t
       JOIN products p ON p.id = t.id
       WHERE p."imageUrl" IS NULL`,
    );

    // 5. Sem @handle a URL do post não existe e o vídeo não abre.
    await consulta(
      'video-sem-link',
      'Vídeos da vitrine sem link do post',
      'O usuário clica para ver o criativo e não vai a lugar nenhum.',
      10,
      `SELECT v.caption AS title FROM videos v
       JOIN (${topo}) t ON t.id = v."productId"
       WHERE v."videoUrl" IS NULL`,
    );

    // 6. Loja não informada em produto de topo.
    await consulta(
      'sem-loja',
      'Produtos do topo sem nome de loja',
      '"Loja não informada" no item mais vendido do mês parece dado incompleto — e é.',
      10,
      `SELECT t.title FROM (${topo}) t
       JOIN products p ON p.id = t.id
       WHERE p."storeName" IS NULL`,
    );

    const graves = achados.filter((a) => a.grave).length;
    if (graves) {
      for (const a of achados.filter((x) => x.grave)) {
        this.logger.warn(
          `Vitrine: ${a.titulo} → ${a.quantidade} (limite ${a.limite}). Ex.: ${a.exemplos.join(' · ')}`,
        );
      }
    } else {
      this.logger.log('Vitrine auditada: nenhum achado grave.');
    }

    return { topo: this.TOPO, achados, graves };
  }
}
