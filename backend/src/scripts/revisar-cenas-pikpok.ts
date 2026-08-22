import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AppModule } from '../app.module';
import { CampaignsService } from '../modules/campaigns/campaigns.service';
import { Campaign } from '../modules/campaigns/entities/campaign.entity';
import { AppUser } from '../modules/users/entities/app-user.entity';

/**
 * Revisão manual das cenas da campanha "PikPok Sistema" (um software, não um
 * objeto): tira "segurar na mão"/"carrinho", usa as telas reais como frame e
 * fecha com CTA de assinatura. Edição de cena é grátis; só render cobra.
 *
 *   npx ts-node src/scripts/revisar-cenas-pikpok.ts <email> <campaignId>
 */
const P = '/api/v1/media/s3/user-products/b4e5a0e6-787e-4366-b31f-d892d62fa743-';
const FOTO = {
  logo: `${P}2719dae9e1a37556.webp`,
  dashboard: `${P}f02be5353ad62b48.webp`,
  produtos: `${P}0622c3b2c39039ff.webp`,
  videos: `${P}dc9994adb75a57b2.webp`,
  estudio: `${P}b092b4a5b3abcb8d.webp`,
};

const CENAS = [
  {
    tipoCena: 'apresentador' as const,
    modoAudio: 'fala' as const,
    fala: 'Cansou de gravar vídeo no escuro sem saber o que vende no TikTok Shop?',
    acaoVisual:
      "Plano médio na sala de casa, luz natural de janela lateral, fundo levemente desfocado. Jéssica, de regata preta e colar fino, olha direto para a câmera como quem desabafa com uma amiga: sobrancelhas franzidas de leve, mão aberta fazendo um gesto de \"não entendo\". A câmera dá um push-in lento. No fim, ela inclina a cabeça, solta um meio sorriso cúmplice e o olhar diz \"mas eu descobri uma coisa\".",
  },
  {
    tipoCena: 'apresentador_produto' as const,
    modoAudio: 'fala' as const,
    baseImageUrl: FOTO.dashboard,
    fala: 'Foi aí que eu achei o PikPok. Olha só isso.',
    acaoVisual:
      "Mesma sala, câmera um pouco mais fechada. Jéssica, animada, ergue o celular na altura do peito e vira a tela para a câmera: o painel do PikPok aparece claro, com os cards de faturamento rastreado, vendas e a lista Top Produtos. Ela aponta para a tela com o indicador, os olhos alternando entre o celular e a câmera, sorriso de quem compartilha um segredo. Corte seco no gesto de apontar.",
  },
  {
    tipoCena: 'produto_close' as const,
    modoAudio: 'narracao' as const,
    baseImageUrl: FOTO.produtos,
    fala: 'Ele mostra os produtos que mais vendem agora, com vendas e comissão.',
    acaoVisual:
      "Close frontal na tela do PikPok, página Produtos, ocupando o quadro inteiro com leve perspectiva. A lista de produtos do TikTok Shop rola devagar para cima; a câmera faz um zoom-in suave e para num item em alta, onde as colunas de vendas e comissão ganham destaque com brilho sutil. Sem mãos nem rosto; reflexos discretos de luz na tela, movimento fluido como screencast.",
  },
  {
    tipoCena: 'produto_close' as const,
    modoAudio: 'narracao' as const,
    baseImageUrl: FOTO.videos,
    fala: 'Você vê os vídeos que estão convertendo de verdade e aprende com eles.',
    acaoVisual:
      "Close da tela Vídeos que Vendem, quadro inteiro. Os cards de vídeo deslizam lateralmente em carrossel; um deles amplia para o centro revelando a thumbnail e as métricas de vendas e visualizações. A câmera acompanha com um pan lento e termina num zoom leve sobre os números. Sem pessoa em quadro; interface clara, tipografia nítida, ritmo de demonstração de app.",
  },
  {
    tipoCena: 'produto_close' as const,
    modoAudio: 'narracao' as const,
    baseImageUrl: FOTO.estudio,
    fala: 'Aí o Estúdio escreve o roteiro e monta o vídeo pronto pra postar.',
    acaoVisual:
      "Close da tela Estúdio — Roteirizar com IA, quadro inteiro. O cursor clica em \"Gerar roteiro\"; o texto aparece sendo digitado linha a linha, campos de produto e tom se preenchem e um card de roteiro salvo surge à direita. A câmera aproxima devagar do texto enquanto ele se forma, brilho suave no botão rosa. Sem mãos nem rosto; sensação de velocidade e facilidade.",
  },
  {
    tipoCena: 'apresentador_produto' as const,
    modoAudio: 'fala' as const,
    baseImageUrl: FOTO.logo,
    fala: 'Por 39,90 por mês. Entra no pikpokviral.com.br e testa hoje.',
    acaoVisual:
      "Volta ao plano médio na sala, Jéssica de frente, relaxada e sorridente, com o logo do PikPok composto ao lado dela em tamanho de referência. Ela aponta uma vez para baixo com a mão livre, como quem indica o link, depois junta as mãos num gesto de \"é isso\". Push-in curto da câmera, olhar fixo na lente até o último frame, convidando a agir. Luz quente, fechamento de UGC.",
  },
];

async function main() {
  const [email, campaignId] = process.argv.slice(2);
  if (!email || !campaignId) {
    console.error('Uso: npx ts-node src/scripts/revisar-cenas-pikpok.ts <email> <campaignId>');
    process.exit(1);
  }
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
  try {
    const users: Repository<AppUser> = app.get(getRepositoryToken(AppUser));
    const campanhas: Repository<Campaign> = app.get(getRepositoryToken(Campaign));
    const svc = app.get(CampaignsService);
    const user = await users.findOneBy({ email: email.toLowerCase().trim() });
    if (!user) throw new Error(`Usuário não encontrado: ${email}`);

    // Quem apresenta: a Jéssica. Nada foi renderizado, então trocar é grátis.
    const JESSICA = 'f2d1808a-b3cd-4a81-a70b-f2dfafbd6c46';
    await campanhas.update({ id: campaignId, userId: user.id }, { personaId: JESSICA });
    const detalhe = await svc.detalharCampanha(user.id, campaignId);
    console.log(`Apresenta: ${detalhe.persona?.label}\n`);
    const cenas = [...detalhe.cenas].sort((a, b) => a.ordem - b.ordem);
    if (cenas.length !== CENAS.length) {
      throw new Error(`Campanha tem ${cenas.length} cenas; a revisão cobre ${CENAS.length}.`);
    }

    for (let i = 0; i < CENAS.length; i++) {
      const atual = await svc.editarCena(user.id, cenas[i].id, CENAS[i]);
      console.log(`Cena ${atual.ordem} ${atual.tipo}/${atual.modoAudio}: "${atual.fala}"`);
    }

    const script = [
      `# Roteiro — ${detalhe.title}`,
      '',
      ...CENAS.map((c, i) => `**Cena ${i + 1}** _[${c.acaoVisual}]_\n"${c.fala}"\n`),
    ].join('\n');
    await campanhas.update({ id: campaignId }, { script });
    console.log('\nRoteiro atualizado.');
  } finally {
    await app.close();
  }
}
main().catch((err) => { console.error(err); process.exit(1); });
