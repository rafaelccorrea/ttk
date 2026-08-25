import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AuthUser } from '../auth/auth-user';
import {
  COMP_ACCOUNT_PLAN,
  isCompAccount,
  planAllows,
} from '../billing/billing.config';
import { MediaMirrorService } from '../media/media-mirror.service';
import { AppUser } from './entities/app-user.entity';
import { NovaContaService } from './nova-conta.service';

/** Intervalo mínimo entre duas gravações de `lastSeenAt` da mesma conta. */
const LAST_SEEN_FOLGA_MS = 5 * 60 * 1000;

/**
 * Quanto tempo o registro carregado pelo guard vale sem voltar ao banco.
 *
 * O banco fica em outro continente (~160 ms por ida), e o guard roda em TODA
 * requisição autenticada — antes deste cache, cada clique pagava essa ida só
 * para confirmar que a conta existe. Quem escreve plano chama `invalidar()`;
 * o resto (nome, foto, lastSeen) tolera 30 s de atraso.
 */
const ENSURE_CACHE_TTL_MS = 30 * 1000;

@Injectable()
export class UsersService {
  private readonly ensureCache = new Map<
    string,
    { user: AppUser; expiresAt: number }
  >();

  constructor(
    @InjectRepository(AppUser)
    private readonly repository: Repository<AppUser>,
    private readonly mirror: MediaMirrorService,
    private readonly novaConta: NovaContaService,
  ) {}

  /** Esquece a cópia em memória — chamar depois de escrever plano. */
  invalidar(id: string): void {
    this.ensureCache.delete(id);
  }

  /**
   * Upsert leve chamado pelo guard a cada requisição autenticada.
   *
   * Cuidado histórico: o orIgnore só protege contra conflito de id. Um token
   * com outro `sub` mas o MESMO e-mail criava uma segunda conta sem senha, e
   * o login passava a encontrar a errada ("e-mail ou senha incorretos" numa
   * conta válida). Por isso conferimos o e-mail antes de inserir.
   */
  async ensure(user: AuthUser): Promise<AppUser | null> {
    const cached = this.ensureCache.get(user.id);
    if (cached && cached.expiresAt > Date.now()) return cached.user;
    // Primeiro pelo id (chave primária, uma ida); o e-mail só entra quando o
    // id não existe — caso raro do cadastro, não o caminho de cada clique.
    const existing =
      (await this.repository.findOneBy({ id: user.id })) ??
      (await this.repository.findOneBy({ email: user.email }));
    const comp = isCompAccount(user.email);
    if (existing) {
      // Conta de cortesia entra aqui a cada request, mas só escreve quando o
      // plano realmente divergiu — o caminho normal continua sendo só o SELECT
      // acima. É isto que reergue o acesso da equipe se um webhook de
      // cancelamento rebaixar a conta por engano.
      if (comp && existing.plan !== COMP_ACCOUNT_PLAN) {
        await this.repository.update(
          { id: existing.id },
          { plan: COMP_ACCOUNT_PLAN },
        );
        existing.plan = COMP_ACCOUNT_PLAN;
      }
      // "Visto por último", com folga: um UPDATE a cada request seria escrever
      // a cada clique; a cada 5 minutos já diz quem usa o app e quem sumiu.
      const visto = existing.lastSeenAt?.getTime() ?? 0;
      if (Date.now() - visto > LAST_SEEN_FOLGA_MS) {
        existing.lastSeenAt = new Date();
        // Sem await: o carimbo não muda a resposta desta requisição.
        void this.repository
          .update({ id: existing.id }, { lastSeenAt: existing.lastSeenAt })
          .catch(() => undefined);
      }
      this.ensureCache.set(user.id, {
        user: existing,
        expiresAt: Date.now() + ENSURE_CACHE_TTL_MS,
      });
      return existing;
    }
    const inserido = await this.repository
      .createQueryBuilder()
      .insert()
      .values({
        id: user.id,
        email: user.email,
        ...(comp ? { plan: COMP_ACCOUNT_PLAN } : {}),
      })
      .orIgnore()
      .execute();
    // `ON CONFLICT DO NOTHING` devolve zero linhas quando a conta já existia
    // (duas requisições simultâneas do mesmo login) — só a que inseriu avisa.
    if ((inserido.raw as unknown[]).length > 0) {
      this.novaConta.avisar({ id: user.id, email: user.email, origem: 'supabase' });
    }
    return this.repository.findOneBy({ id: user.id });
  }

  async findById(id: string): Promise<AppUser> {
    const user = await this.repository.findOneBy({ id });
    if (!user) {
      throw new NotFoundException(`Usuário ${id} não encontrado`);
    }
    return user;
  }

  async updateProfile(id: string, displayName: string): Promise<AppUser> {
    await this.repository.update({ id }, { displayName });
    this.invalidar(id);
    return this.findById(id);
  }

  /**
   * Troca a foto de perfil.
   *
   * A imagem é normalizada e guardada no nosso bucket, como as demais: a URL
   * fica permanente e não depende de host de terceiro. A chave leva o hash do
   * conteúdo, então reenviar a mesma foto não cria objeto novo.
   */
  async updateAvatar(id: string, buffer: Buffer): Promise<AppUser> {
    /*
     * Guardar arquivo é custo nosso (storage + egress), então é recurso pago.
     *
     * A checagem é aqui, e não com o `PlanFeatureGuard` do controller, porque
     * o BillingModule já importa o UsersModule — pendurar o guard aqui fecharia
     * um ciclo de módulos. O dado necessário é só o plano, que este repositório
     * já tem em mãos.
     */
    const dono = await this.repository.findOneBy({ id });
    if (!planAllows(dono?.plan ?? 'free', 'uploads')) {
      throw new ForbiddenException(
        'A foto de perfil está disponível a partir do plano Essencial. Assine em Planos & Créditos.',
      );
    }

    const url = await this.mirror.putImage(buffer, 'avatars', id, 'cover');
    if (!url) {
      throw new BadRequestException(
        'A imagem não pôde ser guardada. Envie um PNG ou JPG.',
      );
    }
    await this.repository.update({ id }, { avatarUrl: url });
    return this.findById(id);
  }
}
