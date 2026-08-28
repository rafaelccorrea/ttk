/**
 * Tetos por ação, para as rotas que custam dinheiro de verdade.
 *
 * O teto global (120 req/min) é sobre volume: ele impede alguém de martelar a
 * API, e não distingue um GET de catálogo de uma geração de vídeo. Só que o
 * custo dessas duas coisas não se parece — cada chamada de IA vira token pago
 * no fornecedor, minuto de Whisper, ou um render na Higgsfield. Num ritmo que o
 * limite global aceita de bom grado (dois por segundo), uma conta sozinha
 * queima a fatura do mês em uma tarde.
 *
 * O sistema de créditos já cobra por isso e é o controle primário — estes
 * limites são a segunda linha, para o caso em que a cobrança não é o que
 * segura: um bug de estorno, uma ação que ainda não debita, uma conta de
 * cortesia (`COMP_ACCOUNT_EMAILS`, sem saldo para acabar), ou um cliente
 * legítimo com um laço infinito no navegador. Nenhum desses é hipotético.
 *
 * A janela é de UMA HORA, e não de um minuto, de propósito: quem abusa não
 * precisa de rajada, precisa de volume acumulado. Um teto por minuto generoso
 * o bastante para não atrapalhar ninguém ainda permite milhares de chamadas por
 * dia; o mesmo número por hora não permite.
 *
 * Aplicados com `UserThrottlerGuard` no controller, os limites contam por CONTA
 * (e o guard global continua contando por IP em paralelo) — o que impede tanto
 * a conta que troca de IP quanto o IP que cria contas.
 */
const HORA = 60 * 60 * 1000;
const MINUTO = 60 * 1000;

/**
 * Geração cara e demorada: vídeo, render de campanha, corte de gravação,
 * transcrição. Cada uma custa de centavos a alguns reais no fornecedor e leva
 * minutos. Vinte por hora é muito mais do que qualquer pessoa consegue revisar.
 */
export const LIMITE_IA_PESADA = { default: { ttl: HORA, limit: 20 } };

/**
 * Geração de texto e imagem avulsa: roteiro, análise, retrato de persona,
 * cena. Barata por chamada e usada em ciclo de tentativa e erro, então o teto é
 * mais alto — sessenta por hora é uma a cada minuto, sem parar, por uma hora.
 */
export const LIMITE_IA = { default: { ttl: HORA, limit: 60 } };

/**
 * Upload de arquivo. O teto aqui não é sobre IA: é sobre banda de entrada,
 * espaço no espelho e o CPU do ffmpeg/sharp que roda depois.
 */
export const LIMITE_UPLOAD = { default: { ttl: HORA, limit: 30 } };

/**
 * Ações que mandam e-mail nosso ou abrem conversa com o suporte. O custo é a
 * reputação do remetente e o tempo de quem atende.
 */
export const LIMITE_CONTATO = { default: { ttl: HORA, limit: 20 } };

/**
 * Operação global de infraestrutura (disparar ingestão, mexer no agendamento).
 * Já é restrita a administrador; o teto é a rede contra o clique repetido que
 * enfileira dez scrapings simultâneos contra a cota do fornecedor.
 */
export const LIMITE_OPERACAO = { default: { ttl: HORA, limit: 10 } };

/**
 * O copiloto ao vivo é a exceção: o app de desktop conversa com estas rotas o
 * tempo todo durante uma transmissão (batimento, lote de comentários, eventos,
 * métricas). O teto padrão de 120/min cortaria uma live movimentada no meio, e
 * derrubar o copiloto de quem está vendendo ao vivo é pior do que qualquer
 * abuso que este número evitaria. Continua sendo um teto — só que dimensionado
 * para o uso real, e por conta.
 */
export const LIMITE_LIVE = { default: { ttl: MINUTO, limit: 600 } };
