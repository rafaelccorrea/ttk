# Segurança — PikPok

## 🔴 AÇÃO URGENTE: credenciais expostas no histórico do git

Dois snapshots do `backend/.env` foram commitados por engano pela extensão
*Local History* do VS Code e continuam recuperáveis no histórico:

```
.history/backend/.env_20260814222227
.history/backend/.env_20260814222303
```

Ambos entraram no commit `bf740bd` (14/08/2026). O commit `9473362` passou a
ignorar `.history/`, mas **isso não apaga o que já foi commitado** — qualquer
pessoa com acesso ao repositório (ou a qualquer clone/fork/backup dele) lê os
valores com um `git show`.

Foi verificado que **todos os segredos vazados ainda são os que estão em uso
hoje**, em `.env` e `.env.production`:

| Credencial | Impacto se explorada |
| --- | --- |
| `DATABASE_URL` / `DB_PASSWORD` (Supabase) | Leitura e escrita em todo o banco: usuários, hashes de senha, créditos |
| `JWT_SECRET` | Forjar um token válido com o `sub` de qualquer usuário — acesso a qualquer conta |
| `ANTHROPIC_API_KEY` | Consumo ilimitado faturado na sua conta |
| `OPENAI_API_KEY` | Consumo ilimitado faturado na sua conta |
| `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` | Acesso ao S3 conforme a policy da chave |
| `HIGGSFIELD_API_KEY` / `_SECRET` | Gerações faturadas na sua conta |

### Ordem de execução

**1. Rotacionar tudo primeiro.** Reescrever o histórico não invalida chave
nenhuma — quem já clonou o repositório continua com os valores antigos. A
rotação é o que fecha o buraco; a limpeza do histórico é higiene depois.

- Supabase → Settings > Database > *Reset database password*
- Anthropic → console.anthropic.com > API Keys > revogar e criar nova
- OpenAI → platform.openai.com > API Keys > revogar e criar nova
- AWS → IAM > a chave `AKIASUQF7QTXYXGAR5N7` > *Deactivate* e depois *Delete*, criar outra
- Higgsfield → painel do fornecedor > rotacionar par de chaves
- `JWT_SECRET` → `openssl rand -hex 32`

**2. Revisar faturas e logs de acesso** dos provedores de IA e da AWS
(CloudTrail) desde 14/08/2026, procurando uso que não seja seu. Vazamento de
chave de IA em repositório é varrido por bot em questão de horas.

**3. Trocar o `JWT_SECRET` desconecta todo mundo.** Os tokens em circulação
foram assinados com o segredo antigo e passam a ser rejeitados — é o efeito
desejado, já que o segredo antigo é público. Avise os usuários que vão precisar
entrar de novo.

**4. Limpar o histórico** (opcional, depois da rotação):

```bash
# git-filter-repo (recomendado; instale com: pip install git-filter-repo)
git filter-repo --path .history --invert-paths --force
git push --force --all
```

Isso reescreve os hashes de commit. Todo mundo que tem clone precisa
re-clonar. Se o repositório for público ou tiver forks, considere os segredos
comprometidos de forma permanente e confie apenas na rotação do passo 1.

**5. Impedir a reincidência.** `.history/` e `.env*` já estão no `.gitignore`.
Vale ativar *secret scanning* (grátis no GitHub) ou um hook de pre-commit
(`gitleaks`), porque `.gitignore` não protege contra `git add -f` nem contra
uma extensão nova que grave em outro diretório.

---

## Correções aplicadas nesta revisão

### Autenticação

- **`JWT_SECRET` tinha fallback `'change-me'`** (`auth.service.ts`). A API subia
  normalmente sem o segredo configurado e assinava tokens com um valor
  conhecido — qualquer um forjaria um JWT com o `sub` de outra pessoa. Agora o
  segredo é obrigatório, exige 32+ caracteres, e a validação roda no boot
  (`main.ts`) para falhar na largada em vez de na primeira requisição.
- **`dev-login` dependia só de uma variável de ambiente.** A rota emite um token
  válido para qualquer e-mail, sem senha; `ALLOW_DEV_LOGIN=true` marcado por
  engano em produção seria takeover de todas as contas. Agora `NODE_ENV=production`
  desliga a rota incondicionalmente, e a API se recusa a subir com a combinação.
- **Algoritmo do JWT não era fixado na verificação** (`supabase-auth.guard.ts`).
  Sem `algorithms`, a lista aceita é inferida do formato da chave e o header
  `alg` do token participa da decisão — a escolha do algoritmo tem que ser
  nossa. Agora HS256 é fixo, e os tokens da própria API carregam e verificam
  `issuer`/`audience`, separando-os dos tokens do Supabase.
- **Senha mínima subiu de 6 para 10 caracteres**, com teto de 128 (senha gigante
  em bcrypt é vetor de DoS). O texto do frontend acompanhou.

### Controle de acesso

- **`POST /api/v1/trends` aceitava escrita anônima** — era o único controller
  sem `SupabaseAuthGuard`. Os `GET` também entregavam dados do produto sem login.

### SSRF no proxy de mídia (`/api/v1/media/proxy`)

A rota é anônima e busca uma URL escolhida pelo cliente, o que a torna um
pedido HTTP feito de dentro da rede. A proteção anterior era uma regex sobre o
*texto* do hostname, e não segurava:

- **Redirect.** O `fetch` usava `redirect: 'follow'`, então as checagens valiam
  só para o primeiro salto: um host público respondendo `302` para
  `http://169.254.169.254/` alcançava o metadata da cloud. Agora os saltos são
  seguidos manualmente (máx. 3), revalidando cada um.
- **DNS.** Qualquer domínio público pode ter um registro `A` apontando para
  `127.0.0.1`; comparar strings não vê isso. Agora o hostname é resolvido e o IP
  precisa estar na faixa `unicast` (exclui loopback, privadas, link-local,
  CGNAT, reservadas), com o caso IPv4-mapeado-em-IPv6 tratado.
- **Tamanho e tempo.** Sem teto, uma URL apontando para um arquivo enorme
  derrubava o processo por memória. Agora: 20 MB de corte na leitura do corpo,
  timeout de 10 s e limite de requisições por IP.

Na rota `/media/s3/*`, a checagem de `..` passou a ser uma allowlist de
caracteres aplicada **depois** de decodificar a URL — antes, `%2e%2e%2f` passava
pela verificação e virava `../` no S3.

### Superfície e cabeçalhos

- **`helmet`** adicionado (HSTS, `X-Content-Type-Options`, `X-Frame-Options` etc.).
- **Swagger fora do ar em produção.** Ele documenta rotas, DTOs e exemplos —
  um mapa da superfície de ataque. Reative com `ENABLE_SWAGGER=true` se precisar.
- **CORS não libera mais `localhost` em produção.** Com ele na lista, uma página
  rodando na máquina de um atacante conversava com a API autenticada do usuário.
  Em produção só `APP_URL` vale, e ela virou obrigatória.
- **`whitelist: true` documentado** no `ValidationPipe`: campo fora do DTO é
  descartado, o que barra mass-assignment.

### Rate limiting

Antes não havia nenhum: `/auth/login` aceitava força bruta ilimitada e
`/auth/forgot-password` era um canhão de spam com o nosso remetente.

| Rota | Limite |
| --- | --- |
| Global | 120 req/min por IP |
| `POST /auth/login` | 10 / 5 min |
| `POST /auth/register`, `/resend`, `/forgot-password` | 5 / hora |
| `POST /auth/reset-password` | 10 / hora |
| `GET /media/proxy` | 120 / min |
| `POST /billing/stripe/webhook` | isento (rajada legítima do Stripe; a assinatura já autentica) |

### Duplo-clique nas ações de IA

Toda geração de IA gasta crédito do usuário e token pago no provedor. O
`disabled={loading}` dos botões é feedback visual, não garantia: o React só
desabilita no render seguinte, e um duplo-clique cabe nessa janela — sem contar
duas abas, retry de rede, ou chamada direta à API.

- **Backend** (`SingleFlightInterceptor`): duas requisições idênticas do mesmo
  usuário (mesma rota + mesmo corpo) não rodam em paralelo — a segunda recebe o
  resultado da primeira. Cobra uma vez, e o usuário vê o resultado em vez de um
  erro. Aplicado em `/studio/transcribe`, `/studio/analyze`,
  `/studio/scripts/generate` e `POST /videogen`.
- **Frontend**: trava por `ref` (muda no mesmo tick, antes de qualquer render)
  nos handlers de Studio, Analyze e Prompts.

> A trava do backend é em memória do processo. Com mais de uma instância atrás
> de um load balancer ela vira "uma trava por instância" — nesse cenário, troque
> o `Map` por Redis (`SET NX PX`) mantendo a mesma chave.

O débito de crédito em si (`billing.service.charge`) já era atômico — o `UPDATE`
só afeta a linha se o saldo for suficiente, então o saldo nunca fica negativo.

---

## Pendências conhecidas

- **Token não é revogável.** O JWT é stateless e vale 7 dias: trocar a senha não
  derruba as sessões abertas. Se um token vazar, só a troca do `JWT_SECRET`
  (que desconecta todo mundo) resolve. Para revogação por usuário, o caminho é
  um campo `tokenVersion` no `AppUser`, incluído no token e conferido no guard.
- **Token no `localStorage`.** Fica exposto a XSS. É a escolha comum em SPA e o
  `helmet` reduz a superfície, mas cookie `httpOnly` + `SameSite` é mais seguro
  se a arquitetura permitir.
- **`PATCH /ingestion/schedule` não distingue admin de usuário comum.** Qualquer
  conta com o recurso `ingestion` no plano altera o agendamento global de
  scraping. Falta um papel de administrador.
