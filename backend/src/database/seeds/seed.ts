import 'dotenv/config';
import { DataSource } from 'typeorm';
import { PromptTemplate } from '../../modules/studio/entities/prompt-template.entity';
import { ProductMetricDaily } from '../../modules/products/entities/product-metric-daily.entity';
import { Product } from '../../modules/products/entities/product.entity';

// Seed determinístico: mesmo resultado em qualquer máquina (LCG simples).
let seedState = 42;
function rand(): number {
  seedState = (seedState * 1664525 + 1013904223) % 4294967296;
  return seedState / 4294967296;
}
function randInt(min: number, max: number): number {
  return Math.floor(rand() * (max - min + 1)) + min;
}

const CATALOG: Array<{ category: string; items: Array<[string, number]> }> = [
  {
    category: 'beleza',
    items: [
      ['Protetor Solar Facial FPS 70 Uniformizador', 21.7],
      ['Sérum GHK-Cu Peptídeos de Cobre 30ml', 69.17],
      ['Kit Anti-acne Gel Hidratante + Mix', 135.2],
      ['Clareador Dérmico 60g Facial e Corporal', 79.99],
      ['Kit Cílios Extensão Banda Invisível 144pcs', 22.0],
      ['Progressiva Orgânica Liso Imediato', 11.96],
    ],
  },
  {
    category: 'moda-feminina',
    items: [
      ['Cinta Modeladora Alta Compressão', 19.99],
      ['Calça Legging Flare Flanelada', 28.98],
      ['Calça Jeans Wide Leg Cintura Alta', 47.82],
      ['Jaqueta Puffer Forrada Premium', 114.24],
      ['Vestido Longo Decote Verão Luxo', 21.49],
      ['Biquíni Fita Cortininha Proteção UV', 12.95],
      ['Bolsa Grande Couro PU Premium', 59.99],
    ],
  },
  {
    category: 'moda-masculina',
    items: [
      ['Jaqueta Sarja Capuz Removível Forrado', 153.98],
      ['Kit 3 Bermudas Seda Gelada', 60.81],
      ['Camiseta Oversized Streetwear Estonada', 24.84],
      ['Kit 4 Camisetas Algodão Premium', 56.65],
      ['Kit 3 Shorts Linho Mauricinho', 18.99],
    ],
  },
  {
    category: 'casa-cozinha',
    items: [
      ['Jogo De Panela Cerâmica Premium 21 Peças', 493.9],
      ['Conjunto Panelas Cerâmicas 18 Peças', 516.64],
      ['Fatiador de Legumes Corta Couve', 18.11],
      ['Liquidificador Turbo 3 Velocidades 550W', 88.69],
      ['Fritadeira Air Fryer 5.5L Digital', 254.79],
      ['Lustre Nórdico 3 em 1 Sala e Cozinha', 125.2],
    ],
  },
  {
    category: 'cama-mesa',
    items: [
      ['Coberdrom Casal Queen Sherpa 2,40m', 104.99],
      ['Lençol 400 Fios Percal Kit 3 Peças', 17.14],
      ['Edredom Sherpa Pele de Carneiro', 179.0],
      ['Cortina Blackout Corta Luz com Ilhós', 26.93],
      ['Cobre Leito Boutis Dupla Face 3 Peças', 38.28],
    ],
  },
  {
    category: 'eletronicos',
    items: [
      ['Smartwatch GPS 1.43 Chamada Bluetooth', 297.39],
      ['Caixa de Som Bluetooth LED RGB TWS', 11.38],
      ['Kit 2 Películas Anti-espião iPhone', 48.2],
      ['Fone TWS Bluetooth 5.0 Esportivo', 15.75],
      ['Fita Neon LED 5M RGB Quarto Gamer', 27.9],
      ['Projetor Astronauta Galaxy Nebulosa', 38.0],
    ],
  },
  {
    category: 'fitness',
    items: [
      ['Kit Conjunto Fitness Legging + Short + Top', 109.34],
      ['Bicicleta Ergométrica Spinning 120kg', 447.99],
      ['Kit Halteres Ajustáveis 6 em 1 14kg', 144.1],
      ['Casaco Fitness Poliamida Zíper Grosso', 65.22],
      ['Garrafa Térmica Inox com Canudo', 51.0],
    ],
  },
  {
    category: 'ferramentas',
    items: [
      ['Parafusadeira Furadeira 48V 2 Baterias', 70.06],
      ['Furadeira Brushless 21V Industrial', 55.25],
      ['Kit Amortecedor de Porta Carro 4pçs', 17.09],
    ],
  },
  {
    category: 'infantil',
    items: [
      ['Kit 48 Carrinhos Fricção com Pista', 63.02],
      ['Jogo Tabuleiro 10 Segundos Educativo', 16.9],
      ['Polvo Elétrico Dançante com Música', 21.4],
    ],
  },
  {
    category: 'saude',
    items: [
      ['Massageador Elétrico Pescoço e Ombros', 55.89],
      ['Mix Tropical Nuts 1Kg Castanhas', 51.74],
      ['Escova de Limpeza Elétrica 9 em 1', 46.63],
    ],
  },
];

const STORES = [
  'Achadinhos BR',
  'Mega Ofertas Shop',
  'Loja da Fábrica',
  'Import Express',
  'Top Variedades',
  'Direto do CD',
];

const PROMPTS: Array<Partial<PromptTemplate>> = [
  {
    title: 'Tirando o produto da sacola de compras',
    mediaType: 'video',
    durationSec: 8,
    niches: ['moda-feminina', 'casa'],
    tags: ['unboxing', 'ugc'],
    fields: ['produto', 'ambiente', 'reacao'],
    template:
      'Vídeo vertical 9:16, estilo UGC caseiro, câmera de celular. Uma pessoa em {{ambiente}} tira {{produto}} de uma sacola de compras, mostra para a câmera e reage com {{reacao}}. Iluminação natural, sem texto na tela, 8 segundos.',
  },
  {
    title: 'Textura escorrendo na mão',
    mediaType: 'video',
    durationSec: 4,
    niches: ['beleza', 'skincare'],
    tags: ['demonstracao', 'textura'],
    fields: ['produto', 'textura'],
    template:
      'Close extremo em mão feminina com {{produto}} sendo aplicado. A textura {{textura}} escorre lentamente entre os dedos. Luz suave de janela, fundo desfocado de quarto real, vídeo vertical 4 segundos, estética UGC.',
  },
  {
    title: 'Testando se marca na roupa',
    mediaType: 'video',
    durationSec: 6,
    niches: ['moda-intima'],
    tags: ['antes-e-depois', 'prova'],
    fields: ['produto', 'roupa'],
    template:
      'Pessoa de costas veste {{roupa}} por cima de {{produto}} e vira para mostrar que não marca. Ambiente de quarto simples e real, espelho de guarda-roupa, vídeo vertical 6 segundos, sem cortes.',
  },
  {
    title: 'Testando se aguenta água',
    mediaType: 'video',
    durationSec: 6,
    niches: ['acessorios', 'eletronicos'],
    tags: ['demonstracao', 'prova'],
    fields: ['produto'],
    template:
      'Mãos seguram {{produto}} embaixo de torneira aberta em pia de cozinha comum. A água escorre e o produto continua funcionando. Vídeo vertical 6 segundos, câmera de celular, luz de cozinha real.',
  },
  {
    title: 'Separando as cápsulas do dia na bancada',
    mediaType: 'video',
    durationSec: 6,
    niches: ['saude', 'suplementos'],
    tags: ['rotina'],
    fields: ['produto', 'quantidade'],
    template:
      'Close em bancada de granito: mãos separam {{quantidade}} de {{produto}} ao lado de um copo de água. Movimento natural, luz de cozinha, vídeo vertical 6 segundos, estilo rotina matinal UGC.',
  },
  {
    title: 'Antes e depois no espelho',
    mediaType: 'video',
    durationSec: 8,
    niches: ['moda-feminina', 'fitness'],
    tags: ['antes-e-depois'],
    fields: ['produto', 'look'],
    template:
      'Transição de espelho: primeiro plano a pessoa com roupa comum, bate na câmera, corta para ela usando {{produto}} com {{look}}. Quarto real, luz natural, vídeo vertical 8 segundos.',
  },
  {
    title: 'Aplicando e mostrando o resultado imediato',
    mediaType: 'video',
    durationSec: 8,
    niches: ['beleza', 'cabelo'],
    tags: ['demonstracao', 'antes-e-depois'],
    fields: ['produto', 'area'],
    template:
      'Selfie vídeo em banheiro real: pessoa aplica {{produto}} em {{area}}, espera e aproxima a câmera mostrando o resultado. Fala natural de recomendação, vídeo vertical 8 segundos.',
  },
  {
    title: 'Organizando a casa com o achadinho',
    mediaType: 'video',
    durationSec: 8,
    niches: ['casa', 'limpeza'],
    tags: ['rotina', 'demonstracao'],
    fields: ['produto', 'comodo'],
    template:
      'Timelapse curto de {{comodo}} bagunçado sendo organizado usando {{produto}}. Câmera fixa apoiada, luz de dia, vídeo vertical 8 segundos, final mostrando o resultado com zoom no produto.',
  },
  {
    title: 'Foto de produto em cenário lifestyle',
    mediaType: 'image',
    niches: ['casa', 'decoracao'],
    tags: ['foto-produto'],
    fields: ['produto', 'cenario', 'paleta'],
    template:
      'Fotografia realista de {{produto}} em {{cenario}}, composição lifestyle natural, paleta {{paleta}}, luz suave de janela, profundidade de campo rasa, proporção 9:16.',
  },
  {
    title: 'Recebendo a encomenda na porta',
    mediaType: 'video',
    durationSec: 6,
    niches: ['geral'],
    tags: ['unboxing', 'gancho'],
    fields: ['produto'],
    template:
      'POV: mãos abrem a porta de casa e recebem caixa de encomenda, cortam a fita e revelam {{produto}}. Empolgação genuína, vídeo vertical 6 segundos, câmera na mão, luz natural.',
  },
  {
    title: 'Provando tamanhos diferentes',
    mediaType: 'video',
    durationSec: 8,
    niches: ['moda-feminina', 'moda-masculina'],
    tags: ['prova-social', 'demonstracao'],
    fields: ['produto', 'tamanhos'],
    template:
      'Pessoa prova {{produto}} nos tamanhos {{tamanhos}} em frente ao espelho, comentando o caimento de cada um. Quarto real, vídeo vertical 8 segundos, cortes rápidos.',
  },
  {
    title: 'Comparando com o produto caro',
    mediaType: 'video',
    durationSec: 8,
    niches: ['beleza', 'geral'],
    tags: ['gancho', 'oferta'],
    fields: ['produto', 'concorrente'],
    template:
      'Mesa com dois produtos lado a lado: {{concorrente}} e {{produto}}. Mãos testam os dois alternadamente enquanto voz compara. Final com zoom no mais barato. Vídeo vertical 8 segundos, estilo review honesto.',
  },
];

async function run() {
  const url = process.env.DATABASE_URL;
  const dataSource = new DataSource(
    url
      ? {
          type: 'postgres',
          url,
          ssl: { rejectUnauthorized: false },
          entities: [Product, ProductMetricDaily, PromptTemplate],
          synchronize: true,
        }
      : {
          type: 'postgres',
          host: process.env.DB_HOST ?? 'localhost',
          port: Number(process.env.DB_PORT ?? 5432),
          username: process.env.DB_USERNAME ?? 'postgres',
          password: process.env.DB_PASSWORD ?? 'postgres',
          database: process.env.DB_DATABASE ?? 'pikpok',
          entities: [Product, ProductMetricDaily, PromptTemplate],
          synchronize: true,
        },
  );
  await dataSource.initialize();

  const products = dataSource.getRepository(Product);
  const metrics = dataSource.getRepository(ProductMetricDaily);
  const prompts = dataSource.getRepository(PromptTemplate);

  if ((await products.count()) > 0) {
    console.log('Catálogo já populado — nada a fazer. (Apague as tabelas para re-seedar.)');
    await dataSource.destroy();
    return;
  }

  console.log('Populando catálogo...');
  let index = 0;
  for (const group of CATALOG) {
    for (const [title, price] of group.items) {
      index += 1;
      const product = await products.save(
        products.create({
          externalId: `seed-${index}`,
          title,
          category: group.category,
          storeName: STORES[randInt(0, STORES.length - 1)],
          price: price.toFixed(2),
          rating: (3.9 + rand() * 1.1).toFixed(1),
          radarScore: randInt(50, 99),
        }),
      );

      // 90 dias de métricas com tendência própria por produto.
      const base = randInt(20, 900);
      const trend = rand() * 0.03 - 0.01; // -1% a +2% ao dia
      const rows: Partial<ProductMetricDaily>[] = [];
      for (let day = 90; day >= 1; day--) {
        const date = new Date();
        date.setUTCDate(date.getUTCDate() - day);
        const drift = Math.max(0.1, 1 + trend * (90 - day));
        const noise = 0.6 + rand() * 0.8;
        const sales = Math.max(0, Math.round(base * drift * noise));
        rows.push({
          productId: product.id,
          date: date.toISOString().slice(0, 10),
          sales,
          revenue: (sales * price).toFixed(2),
        });
      }
      await metrics.save(metrics.create(rows));
    }
  }
  console.log(`Catálogo: ${index} produtos com 90 dias de métricas.`);

  console.log('Populando cofre de prompts...');
  await prompts.save(prompts.create(PROMPTS));
  console.log(`Cofre: ${PROMPTS.length} prompts.`);

  await dataSource.destroy();
  console.log('Seed concluído.');
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
