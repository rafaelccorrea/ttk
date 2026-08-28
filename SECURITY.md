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

## Correções aplicadas na segunda revisão

A primeira revisão fechou autenticação, CORS, cabeçalhos, SSRF do proxy de
mídia e o rate limit das rotas de senha. Esta aqui foi atrás do que sobrou —
e do que a primeira arrumou pela metade.

### O rate limit não estava funcionando

O `ThrottlerGuard` conta por `req.ip`, e o Express só sabe qual é o IP do
cliente quando `trust proxy` está configurado. Não estava. Atrás de um reverse
proxy — que é como a API roda em produção — **toda requisição chegava com o
mesmo IP**, o do proxy. Ou seja:

- o teto global de 120/min não era "por cliente", era para o mundo inteiro;
- o limite de 10 tentativas de login por 5 minutos trancava a porta de **todos
  os clientes** assim que um varredor aparecesse. A proteção contra força bruta
  virava a negação de serviço.

Agora existe `TRUST_PROXY`, explícito e por ambiente (`1` = um proxy na frente,
`2` = dois, uma lista de CIDR, ou vazio = não confia em cabeçalho nenhum). O
valor `true` é **recusado no boot**: ele confia no `X-Forwarded-For` inteiro,
inclusive na parte que o cliente escreve, e aí qualquer um forja um IP novo por
requisição e o limite deixa de existir. Em produção sem a variável, o boot
avisa.

A auditoria (`audit.interceptor`) lia o `X-Forwarded-For` na mão pelo mesmo
motivo errado: sem proxy declarado, o endereço registrado era o que o atacante
escrevesse. Um log forjável é pior que log nenhum, porque parece prova. Passou
a usar `req.ip`.

### Rate limit por conta, e nas rotas que custam dinheiro

O guard global roda antes dos guards de controller, então lá só existe o IP.
Isso deixava dois furos: quem tem uma conta e vários IPs (VPN, celular trocando
de rede) ganhava um balde novo a cada troca; e quem está atrás do mesmo NAT que
outros clientes dividia o balde com estranhos.

O `UserThrottlerGuard` entra **depois** do `SupabaseAuthGuard`, onde `req.user`
já existe, e passa a contar por `sub` do token. As duas dimensões valem juntas.

E os limites por rota chegaram nas ações que queimam dinheiro de verdade — até
aqui elas só tinham o teto global, que a 2 req/s aceita de bom grado a fatura do
mês em uma tarde:

| Rota | Limite (por conta e por IP) |
| --- | --- |
| `/studio/transcribe`, `/cuts`, `/cuts/from-url`, `/campaigns/:id/assemble`, `/campaigns/:id/render-all`, `/combinations/:id/render`, `/live/sessions/:id/upload` | 20 / hora |
| `/videogen`, `/studio/analyze`, `/studio/scripts/generate`, `/campaigns/personas`, `/campaigns/:id/script`, `/campaigns/scenes/*/render` | 60 / hora |
| Uploads (`/users/me/avatar`, fotos de produto e persona, clipes, CSV) | 30 / hora |
| `/support/messages` | 20 / hora |
| `/ingestion/run`, `/ingestion/schedule`, `/studio/prompts/refresh` | 10 / hora |
| Copiloto ao vivo (`/live/runs/*`) | 600 / min — o app de desktop conversa o tempo todo durante a transmissão |

> O armazenamento do throttler é a memória do processo. Com mais de uma
> instância atrás de um load balancer, o teto efetivo é `limite × instâncias`.
> Para valer no agregado, troque por `ThrottlerStorageRedisService` mantendo as
> mesmas chaves.

### Upload derrubava o processo por memória

Vários endpoints usavam `FileInterceptor('file')` sem `limits`, confiando no
`MaxFileSizeValidator` do `ParseFilePipe`. Só que pipe roda **depois** que o
multer já leu a requisição inteira: sem `limits.fileSize`, um POST de 2 GB vira
2 GB de heap e o processo morre por OOM — e só então o validador rejeita um
arquivo que já custou o servidor. Uma conta de plano básico derrubava a API de
todo mundo com um `curl`.

Todo `FileInterceptor` passou a levar `limits` (`limiteDeUpload`, em
`common/uploads.ts`) com o mesmo teto do validador, mais `files: 1` (um
multipart com 500 partes respeitaria o teto individual e ainda somaria
gigabytes) e `fields: 100`.

### `/ingestion` era administração disfarçada de plano

A porta era `@RequiresPlanFeature('ingestion')`. O efeito não era o que o nome
sugere: **toda conta Business** — mais toda conta de cortesia — podia desligar o
agendamento global de scraping, reescrever o cron ou disparar ingestão em rajada
contra a cota mensal que nós pagamos. Nada ali é do usuário: é um estado único
compartilhado por toda a plataforma. Passou para `AdminGuard`.

(Era a terceira pendência conhecida da revisão anterior.)

### SSRF: o proxy de mídia tinha uma janela, e o espelhamento não tinha defesa

O proxy validava o IP resolvido e depois deixava o `fetch` **resolver o nome de
novo**. São duas resoluções, e entre elas o dono do domínio troca a resposta —
DNS rebinding, com TTL 0: IP público na primeira consulta, `169.254.169.254` na
segunda. Agora a resolução é uma só e o endereço aprovado é fixado na conexão
(`https.request` com `lookup` próprio; o `servername` continua sendo o nome,
para o certificado ser verificado contra o domínio).

Pior: o `MediaMirrorService` — que baixa as fotos que o **cliente cadastra**
(`CampaignsService.espelharFotos` recebe URLs do corpo da requisição) — não
tinha nenhuma dessas defesas. `fetch` com `redirect: 'follow'`, sem olhar para
onde estava conectando, sem tempo limite, e lendo o corpo inteiro com
`arrayBuffer()` **antes** de comparar com o teto de tamanho.

E `POST /cuts/from-url` / `GET /cuts/url-info` entregavam a URL colada pelo
cliente direto ao `yt-dlp`, que faz o pedido de dentro da nossa rede.

As defesas agora vivem num arquivo só (`modules/media/download-externo.ts`) e
valem para os três: só https, nunca IP literal, IP resolvido tem que ser
público, redirect seguido à mão revalidando cada salto, teto de bytes aplicado
durante a leitura e tempo limite. Onde quem conecta é outro processo (o
`yt-dlp`), o que dá para fazer é recusar o destino antes de entregar o link —
`assertDestinoPublico`.

### O JWT virou revogável

Era a primeira pendência conhecida: trocar a senha não derrubava sessão
nenhuma. O token é stateless e vale 7 dias (30 no app de desktop), então quem
tivesse roubado um token continuava dentro da conta **depois** de a vítima
trocar a senha — que é exatamente o momento em que ela acha que resolveu. O
único remédio era trocar o `JWT_SECRET`, que desconecta todo mundo.

`app_users.tokenVersion` guarda a geração das sessões da conta. Ela entra no
token como a claim `tv` e é conferida no guard; `resetPassword` incrementa, e
todo token anterior daquele usuário morre na hora. Ausência da claim conta como
geração 0 — os tokens em circulação no deploy continuam valendo, e ninguém é
desconectado pela migration. Coberto por testes em
`supabase-auth.guard.spec.ts`.

### TLS do banco não verificava o certificado

`ssl: { rejectUnauthorized: false }` estava fixo. Isso cifra o tráfego e não
verifica com quem se está falando: protege contra quem só escuta, não contra
quem se põe no meio. E o que passa nessa conexão é o banco inteiro — hashes de
senha, e-mails, créditos, tokens de redefinição.

Virou configuração (`DB_SSL_CA` com a CA do provedor, ou `DB_SSL_MODE=verify`
para quem usa CA pública). **O padrão continua permissivo de propósito**: ligar
a verificação sem a CA certa não degrada nada — derruba a conexão e a API
inteira. Em produção o boot avisa, com o caminho da correção na mensagem.

> **Ação pendente do lado da operação:** preencher `DB_SSL_CA` com o
> certificado do Supabase (Settings > Database > SSL Configuration). É a única
> correção desta revisão que depende de um passo fora do código.

### Injeção de shell no CLI da Higgsfield

`getStatus` passava o `requestId` sem citar para uma linha de comando montada
como texto e entregue ao shell. O valor vem da fornecedora e viaja pelo banco
antes de voltar — "é sempre um hex" é uma suposição sobre sistema de terceiro,
não uma garantia nossa. Passou por `citar`, como todo o resto.

### Cabeçalhos de segurança no frontend

O `helmet` só põe cabeçalho na resposta da API. O SPA é servido pelo Apache da
hospedagem e não passa por lá — e é ali que estão o HTML, o JavaScript e o token
no `localStorage`. O `.htaccess` ganhou CSP (com `script-src` sem
`'unsafe-inline'`), `X-Frame-Options: DENY`, `nosniff`, `Referrer-Policy`,
`Permissions-Policy` e HSTS.

### Dependências e CI

- `ipaddr.js` era importado sem estar no `package.json` — a checagem anti-SSRF
  dependia de uma dependência transitiva do Express continuar existindo.
  Declarada.
- `react-router-dom` foi para 7.x, o que zera as vulnerabilidades das
  dependências **de produção** do frontend (eram um open redirect e uma injeção
  de construtor). A superfície de API usada é só
  `BrowserRouter/Routes/Route/Link/Navigate/Outlet` e os hooks — build e testes
  passam sem mudança de código.
- O CI ganhou um job de segurança: `gitleaks` nos commits novos (este
  repositório já perdeu credenciais uma vez, e `.gitignore` não protege contra
  `git add -f`) e `npm audit --omit=dev` nos dois lados, bloqueando em
  `critical`.

---

## Pendências conhecidas

- **`DB_SSL_CA` precisa ser preenchido** em produção — ver acima.
- **Dependências do backend.** Restam 8 avisos altos e 17 moderados nas
  dependências de produção, todos de DoS/ReDoS em pacotes transitivos
  (`multer`, `lodash`, `js-yaml`, `qs`, `body-parser`). A correção passa por
  uma migração de major do NestJS (10 → 12), que é um trabalho à parte e
  arriscado demais para entrar num PR de segurança. Vale notar que boa parte
  não tem versão corrigida em lugar nenhum hoje: o aviso do `multer` cobre
  `<=2.1.1`, ou seja, todas as versões publicadas. O teto de upload agora
  aplicado no multer (`limits`) mitiga a parte alcançável — exaustão por corpo
  gigante e por campos aninhados.
- **Vitest e Vite** têm avisos (um deles crítico, no servidor da UI do Vitest).
  São `devDependencies`: não sobem para produção, e a correção é uma major que
  quebra a suíte de testes. Fica para uma janela própria.
- **Token no `localStorage`.** Continua exposto a XSS. A CSP nova é a defesa
  principal enquanto cookie `httpOnly` + `SameSite` não for viável.
- **Throttler em memória.** Ver a nota na tabela de limites.
- **`yt-dlp` é baixado em runtime** do GitHub, sem conferência de checksum, e
  executado. É HTTPS para o repositório oficial, mas um checksum fixado seria
  mais forte.
- **Credenciais no histórico do git.** A limpeza descrita no topo deste arquivo
  continua pendente. A rotação é o que fecha o buraco — o `gitleaks` no CI
  agora impede a reincidência.
