import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

/**
 * Uma pasta criada pelo vendedor para guardar vídeos montados.
 *
 * O agrupamento automático por produto responde "de qual matriz saiu isto",
 * que é um fato do sistema. A pasta responde "o que EU quero fazer com isto" —
 * "postar essa semana", "campanha do Dia das Mães", "os que já foram ao ar" —
 * e isso o servidor não tem como adivinhar.
 *
 * As duas visões convivem: um vídeo sem pasta continua aparecendo agrupado pelo
 * produto, então nada some por não ter sido organizado.
 */
@Entity('combination_folders')
export class CombinationFolder {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index('IDX_combination_folders_user')
  @Column('uuid')
  userId: string;

  @Column({ length: 60 })
  name: string;

  /**
   * Cor da etiqueta, em hex.
   *
   * Cor é o que torna a pasta reconhecível de relance numa grade de dezenas de
   * miniaturas — procurar pelo nome exigiria ler, que é justamente o trabalho
   * que a pasta deveria poupar.
   */
  @Column({ length: 7, default: '#fe2c55' })
  color: string;

  @CreateDateColumn()
  createdAt: Date;
}
