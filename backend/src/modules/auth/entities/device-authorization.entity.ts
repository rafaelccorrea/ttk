import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

/**
 * Ciclo de vida de uma autorização de dispositivo:
 *
 *  - `pendente`: o app desktop já pediu o código e está perguntando de tempos
 *    em tempos se alguém aprovou;
 *  - `aprovado`: uma pessoa LOGADA na web conferiu o código curto e liberou —
 *    é a única transição que amarra a autorização a um `userId`;
 *  - `negado`: a pessoa viu um código que não reconheceu e recusou;
 *  - `expirado`: ninguém aprovou dentro da janela e o cron encerrou.
 */
export type DeviceAuthorizationStatus =
  | 'pendente'
  | 'aprovado'
  | 'negado'
  | 'expirado';

/**
 * Uma tentativa de parear o app desktop com uma conta (device code flow).
 *
 * O desenho separa dois segredos com públicos diferentes. O `deviceCode` é
 * longo, aleatório e NUNCA aparece na tela: só o app desktop o conhece, e é
 * com ele que o app troca a autorização por um JWT. O `userCode` é curto de
 * propósito, porque um ser humano vai lê-lo no aplicativo e conferi-lo no
 * navegador — ele autoriza, mas não autentica ninguém sozinho.
 */
@Entity('device_authorizations')
export class DeviceAuthorization {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /** Segredo do dispositivo. Trocado por token uma única vez. */
  @Index('IDX_device_authorizations_deviceCode', { unique: true })
  @Column()
  deviceCode: string;

  /**
   * Código curto que a pessoa lê no app e confere no navegador, no formato
   * PIKPOK-XXXX.
   *
   * O alfabeto exclui O, 0, I, 1 (e também L e S, que viram 1 e 5 em fontes
   * condensadas) porque este código é transcrito por um humano lendo uma tela
   * e digitando em outra. Confundir zero com "ó" não gera um erro claro: gera
   * "código inválido" numa tela de segurança, e a pessoa conclui que o
   * aplicativo está quebrado. Tirar os pares ambíguos custa alguns bits de
   * entropia — irrelevantes aqui, porque a janela é de 10 minutos, o status
   * só anda para frente e a aprovação exige uma sessão web já autenticada.
   */
  @Index('IDX_device_authorizations_userCode', { unique: true })
  @Column()
  userCode: string;

  /** Só é preenchido na aprovação — antes disso a autorização não tem dono. */
  @Column({ type: 'uuid', nullable: true })
  userId: string | null;

  @Column({ default: 'pendente' })
  status: DeviceAuthorizationStatus;

  @Column({ type: 'timestamptz' })
  expiresAt: Date;

  @Column({ type: 'timestamptz', nullable: true })
  approvedAt: Date | null;

  /**
   * Marca que o token JÁ foi emitido para esta autorização.
   *
   * É o que transforma o `deviceCode` em segredo de uso único. Sem isso, quem
   * tivesse lido o código uma vez — log, print de tela, proxy corporativo —
   * continuaria trocando-o por tokens novos de 30 dias para sempre, mesmo
   * depois de o dispositivo legítimo já ter recebido o dele.
   */
  @Column({ type: 'timestamptz', nullable: true })
  tokenIssuedAt: Date | null;

  /** Nome que o app informa ("PikPok Desktop — PC da loja"), só para exibir. */
  @Column({ type: 'varchar', nullable: true })
  deviceName: string | null;

  @CreateDateColumn()
  createdAt: Date;
}
