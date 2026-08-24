import CloseRoundedIcon from '@mui/icons-material/CloseRounded';
import {
  Alert,
  Avatar,
  Box,
  Button,
  Chip,
  Divider,
  Drawer,
  Grid,
  IconButton,
  MenuItem,
  Stack,
  Tab,
  Tabs,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import { useEffect, useState } from 'react';
import { BrandLoader } from '@/components/ui/BrandLoader';
import { apiErrorMessage } from '@/contexts/AuthContext';
import { adminService, type AdminUserDetail } from '@/services/admin.service';
import { billingService, type Plan } from '@/services/billing.service';
import { PLANO_COR, brl, dataHora, relativo } from './formato';

const KIND_LABEL: Record<string, string> = {
  signup_bonus: 'Bônus de cadastro',
  sample_video: 'Vídeo de cortesia',
  plan_grant: 'Créditos do plano',
  purchase: 'Compra / ajuste',
  spend: 'Consumo de IA',
  refund: 'Estorno',
};

const MINUTOS_LABEL: Record<string, string> = {
  trial: 'Cortesia de estreia',
  plan_grant: 'Minutos do plano',
  purchase: 'Pacote de horas',
  spend: 'Live',
  refund: 'Estorno',
};

const CAMPANHA_STATUS: Record<string, string> = {
  rascunho: 'rascunho',
  roteiro: 'com roteiro',
  storyboard: 'storyboard',
  renderizando: 'renderizando',
  pronta: 'pronta',
  falhou: 'falhou',
};

/**
 * Ficha da conta: quem é, quando entrou, quando voltou, o que produziu, quanto
 * custou — e as duas ações de suporte que sobram no dia a dia (destravar um
 * acesso, corrigir um saldo).
 *
 * As ações exigem confirmação explícita (o motivo é obrigatório no ajuste de
 * crédito) porque mexem no que o cliente pagou — e ficam registradas no extrato
 * dele, para que ninguém precise adivinhar depois de onde veio um saldo.
 */
export function UserDrawer({
  userId,
  onClose,
  onChanged,
}: {
  userId: string | null;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [user, setUser] = useState<AdminUserDetail | null>(null);
  const [planos, setPlanos] = useState<Plan[]>([]);
  const [novoPlano, setNovoPlano] = useState('');
  const [valor, setValor] = useState('');
  const [motivo, setMotivo] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);
  const [aba, setAba] = useState<'ficha' | 'extrato' | 'acoes'>('ficha');

  useEffect(() => {
    if (!userId) {
      setUser(null);
      return;
    }
    setErro(null);
    setOk(null);
    setAba('ficha');
    Promise.all([adminService.user(userId), billingService.plans()])
      .then(([u, p]) => {
        setUser(u);
        setPlanos(p);
        setNovoPlano(u.plan);
      })
      .catch((e) => setErro(apiErrorMessage(e)));
  }, [userId]);

  async function trocarPlano() {
    if (!user || novoPlano === user.plan) return;
    setSalvando(true);
    setErro(null);
    try {
      const atualizado = await adminService.setPlan(user.id, novoPlano);
      setUser(atualizado);
      setOk(`Plano alterado para ${novoPlano}.`);
      onChanged();
    } catch (e) {
      setErro(apiErrorMessage(e));
    } finally {
      setSalvando(false);
    }
  }

  async function ajustarCreditos() {
    if (!user) return;
    const n = Number(valor);
    if (!Number.isInteger(n) || n === 0) {
      setErro('Informe um número inteiro diferente de zero.');
      return;
    }
    if (!motivo.trim()) {
      setErro('O motivo é obrigatório — ele fica no extrato do cliente.');
      return;
    }
    setSalvando(true);
    setErro(null);
    try {
      const atualizado = await adminService.adjustCredits(user.id, n, motivo.trim());
      setUser(atualizado);
      setValor('');
      setMotivo('');
      setOk(`${n > 0 ? 'Creditados' : 'Retirados'} ${Math.abs(n)} créditos.`);
      onChanged();
    } catch (e) {
      setErro(apiErrorMessage(e));
    } finally {
      setSalvando(false);
    }
  }

  return (
    <Drawer anchor="right" open={Boolean(userId)} onClose={onClose}>
      <Box
        sx={{
          width: { xs: '100vw', sm: 520 },
          maxWidth: '100vw',
          p: { xs: 2, sm: 3 },
          boxSizing: 'border-box',
        }}
      >
        {!user ? (
          erro ? (
            <Alert severity="error">{erro}</Alert>
          ) : (
            <BrandLoader label="Carregando a conta..." />
          )
        ) : (
          <>
            <Stack direction="row" spacing={1.5} alignItems="flex-start">
              <Avatar src={user.avatarUrl ?? undefined} sx={{ width: 44, height: 44, fontWeight: 800 }}>
                {(user.displayName ?? user.email).slice(0, 1).toUpperCase()}
              </Avatar>
              <Box sx={{ minWidth: 0, flex: 1 }}>
                {user.displayName && (
                  <Typography fontWeight={800} fontSize={16} sx={{ wordBreak: 'break-word' }}>
                    {user.displayName}
                  </Typography>
                )}
                <Typography
                  fontSize={user.displayName ? 13 : 16}
                  fontWeight={user.displayName ? 400 : 800}
                  color={user.displayName ? 'text.secondary' : 'text.primary'}
                  sx={{ wordBreak: 'break-word', overflowWrap: 'anywhere' }}
                >
                  {user.email}
                </Typography>
                <Typography fontSize={11.5} color="text.secondary">
                  cadastro {relativo(user.createdAt)} · último acesso{' '}
                  {relativo(user.linhaDoTempo.ultimoAcesso)}
                </Typography>
              </Box>
              <IconButton size="small" onClick={onClose} aria-label="Fechar">
                <CloseRoundedIcon fontSize="small" />
              </IconButton>
            </Stack>

            <Stack direction="row" spacing={1} mt={1.5} flexWrap="wrap" useFlexGap>
              <Chip label={user.plan} size="small" color={PLANO_COR[user.plan] ?? 'default'} sx={{ fontWeight: 700 }} />
              <Chip label={`${user.credits} créditos`} size="small" />
              {user.liveMinutes > 0 && <Chip label={`${user.liveMinutes} min de live`} size="small" />}
              {user.isAdmin && <Chip label="admin" size="small" color="secondary" />}
              {user.cortesia && !user.isAdmin && (
                <Chip label="cortesia" size="small" color="secondary" variant="outlined" />
              )}
              {user.viaGoogle && <Chip label="Google" size="small" variant="outlined" color="info" />}
              {!user.emailConfirmed && !user.viaGoogle && (
                <Chip label="e-mail não confirmado" size="small" variant="outlined" color="warning" />
              )}
              {user.naFila && <Chip label="na fila" size="small" variant="outlined" />}
              {user.stripeCustomerId && (
                <Tooltip title={user.stripeCustomerId}>
                  <Chip label="tem Stripe" size="small" variant="outlined" />
                </Tooltip>
              )}
            </Stack>

            {erro && (
              <Alert severity="error" sx={{ mt: 2 }}>
                {erro}
              </Alert>
            )}
            {ok && (
              <Alert severity="success" sx={{ mt: 2 }}>
                {ok}
              </Alert>
            )}

            <Tabs value={aba} onChange={(_, v) => setAba(v)} sx={{ mt: 2, mb: 2 }} variant="fullWidth">
              <Tab value="ficha" label="Ficha" />
              <Tab value="extrato" label={`Extrato (${user.historico.length})`} />
              <Tab value="acoes" label="Ações" />
            </Tabs>

            {aba === 'ficha' && <Ficha user={user} />}
            {aba === 'extrato' && <Extratos user={user} />}
            {aba === 'acoes' && (
              <>
                <Typography fontWeight={700} fontSize={14} mb={1}>
                  Plano
                </Typography>
                <Stack direction="row" spacing={1}>
                  <TextField
                    select
                    size="small"
                    value={novoPlano}
                    onChange={(e) => setNovoPlano(e.target.value)}
                    sx={{ flex: 1, minWidth: 0 }}
                  >
                    <MenuItem value="free">Pagamento pendente (free)</MenuItem>
                    {planos.map((p) => (
                      <MenuItem key={p.id} value={p.id}>
                        {p.name}
                      </MenuItem>
                    ))}
                  </TextField>
                  <Button
                    variant="outlined"
                    disabled={salvando || novoPlano === user.plan}
                    onClick={() => void trocarPlano()}
                    sx={{ flexShrink: 0 }}
                  >
                    Aplicar
                  </Button>
                </Stack>
                <Typography fontSize={11.5} color="text.secondary" mt={0.75}>
                  Não mexe na assinatura do Stripe — se houver uma ativa, a próxima renovação
                  prevalece.
                </Typography>

                <Divider sx={{ my: 2.5 }} />

                <Typography fontWeight={700} fontSize={14} mb={1}>
                  Ajustar créditos
                </Typography>
                <Stack spacing={1}>
                  <TextField
                    size="small"
                    label="Quantidade (negativo retira)"
                    value={valor}
                    onChange={(e) => setValor(e.target.value)}
                    placeholder="ex.: 100 ou -50"
                  />
                  <TextField
                    size="small"
                    label="Motivo (vai para o extrato do cliente)"
                    value={motivo}
                    onChange={(e) => setMotivo(e.target.value)}
                  />
                  <Button variant="contained" disabled={salvando} onClick={() => void ajustarCreditos()}>
                    Lançar ajuste
                  </Button>
                </Stack>
              </>
            )}
          </>
        )}
      </Box>
    </Drawer>
  );
}

/** Linha da tempo, indicação, o que produziu e quanto custou. */
function Ficha({ user }: { user: AdminUserDetail }) {
  const t = user.linhaDoTempo;
  const a = user.atividade;
  const margem =
    user.custoIa.totalBrl > 0 ? user.custoIa.receitaEmCreditosBrl / user.custoIa.totalBrl : null;
  return (
    <>
      <Titulo>Linha do tempo</Titulo>
      <Linha rotulo="Cadastro" valor={dataHora(t.cadastro)} detalhe={relativo(t.cadastro)} />
      <Linha
        rotulo="E-mail confirmado"
        valor={t.emailConfirmado ? dataHora(t.emailConfirmado) : user.viaGoogle ? 'via Google' : 'ainda não'}
        alerta={!t.emailConfirmado && !user.viaGoogle}
      />
      {t.entrouNaFila && <Linha rotulo="Entrou na fila" valor={dataHora(t.entrouNaFila)} />}
      {t.liberadoDaFila && <Linha rotulo="Liberado da fila" valor={dataHora(t.liberadoDaFila)} />}
      {t.cortesiaDeLive && <Linha rotulo="Cortesia de live" valor={dataHora(t.cortesiaDeLive)} />}
      <Linha
        rotulo="Último acesso"
        valor={t.ultimoAcesso ? dataHora(t.ultimoAcesso) : 'sem registro'}
        detalhe={t.ultimoAcesso ? relativo(t.ultimoAcesso) : undefined}
      />
      <Linha rotulo="Última alteração" valor={dataHora(t.ultimaAlteracao)} detalhe={relativo(t.ultimaAlteracao)} />

      <Divider sx={{ my: 2 }} />
      <Titulo>O que produziu</Titulo>
      <Grid container spacing={1}>
        <Tile n={a.produtos} rotulo="produtos" />
        <Tile n={a.personas} rotulo="apresentadores" />
        <Tile
          n={a.campanhas.total}
          rotulo="campanhas"
          detalhe={Object.entries(a.campanhas.porStatus)
            .map(([s, n]) => `${n} ${CAMPANHA_STATUS[s] ?? s}`)
            .join(' · ')}
        />
        <Tile
          n={a.videosGerados.total}
          rotulo="vídeos gerados"
          detalhe={
            a.videosGerados.total
              ? `${a.videosGerados.prontos} prontos · ${a.videosGerados.falhos} falhos · último ${relativo(a.videosGerados.ultimo)}`
              : undefined
          }
        />
        <Tile n={a.roteiros} rotulo="roteiros (Estúdio)" />
        <Tile n={a.multiplicador} rotulo="vídeos do Multiplicador" />
        <Tile
          n={a.lives.total}
          rotulo="lives"
          detalhe={
            a.lives.total
              ? `${a.lives.minutosUsados} min · última ${relativo(a.lives.ultima)}`
              : undefined
          }
        />
        <Tile n={a.creditosGastos} rotulo="créditos gastos" />
      </Grid>

      <Divider sx={{ my: 2 }} />
      <Titulo>Custo de IA desta conta</Titulo>
      <Linha rotulo="Custo real (telemetria)" valor={brl(user.custoIa.totalBrl)} detalhe={`${user.custoIa.eventos} chamada(s)`} />
      <Linha rotulo="Custo real · 30 dias" valor={brl(user.custoIa.ultimos30DiasBrl)} />
      <Linha rotulo="Pagou em créditos (valor de face)" valor={brl(user.custoIa.receitaEmCreditosBrl)} />
      <Linha
        rotulo="Margem"
        valor={margem === null ? '—' : `${margem.toFixed(1)}×`}
        alerta={margem !== null && margem < 1.4}
        detalhe={margem !== null && margem < 1.4 ? 'abaixo do piso de 1,4×' : undefined}
      />

      <Divider sx={{ my: 2 }} />
      <Titulo>Indicação</Titulo>
      <Linha rotulo="Indicado por" valor={user.indicacao.indicadoPor ?? '—'} />
      {user.indicacao.recompensaPagaEm && (
        <Linha rotulo="Recompensa paga em" valor={dataHora(user.indicacao.recompensaPagaEm)} />
      )}
      <Linha
        rotulo="Indicou"
        valor={`${user.indicacao.indicados} conta(s)`}
        detalhe={`${user.indicacao.indicadosQuePagaram} viraram pagantes`}
      />
    </>
  );
}

/** Extrato de créditos e de minutos de live, lado a lado por aba. */
function Extratos({ user }: { user: AdminUserDetail }) {
  const [qual, setQual] = useState<'creditos' | 'minutos'>('creditos');
  return (
    <>
      <Stack direction="row" spacing={1} mb={1.5}>
        <Chip
          label={`Créditos (${user.historico.length})`}
          size="small"
          color={qual === 'creditos' ? 'primary' : 'default'}
          onClick={() => setQual('creditos')}
        />
        <Chip
          label={`Minutos de live (${user.historicoMinutos.length})`}
          size="small"
          color={qual === 'minutos' ? 'primary' : 'default'}
          onClick={() => setQual('minutos')}
        />
      </Stack>
      <Stack spacing={1}>
        {qual === 'creditos' &&
          user.historico.map((t) => (
            <Lancamento
              key={t.id}
              titulo={KIND_LABEL[t.kind] ?? t.kind}
              descricao={t.description ?? t.action ?? '—'}
              quando={t.createdAt}
              valor={t.amount}
              unidade=""
            />
          ))}
        {qual === 'minutos' &&
          user.historicoMinutos.map((t) => (
            <Lancamento
              key={t.id}
              titulo={MINUTOS_LABEL[t.kind] ?? t.kind}
              descricao={t.description ?? '—'}
              quando={t.createdAt}
              valor={t.minutes}
              unidade=" min"
            />
          ))}
        {qual === 'creditos' && user.historico.length === 0 && <Vazio />}
        {qual === 'minutos' && user.historicoMinutos.length === 0 && <Vazio />}
      </Stack>
    </>
  );
}

function Lancamento({
  titulo,
  descricao,
  quando,
  valor,
  unidade,
}: {
  titulo: string;
  descricao: string;
  quando: string;
  valor: number;
  unidade: string;
}) {
  return (
    <Stack
      direction="row"
      justifyContent="space-between"
      alignItems="flex-start"
      sx={{ borderBottom: '1px solid rgba(22,24,35,0.06)', pb: 0.75 }}
    >
      <Box sx={{ pr: 1, minWidth: 0, wordBreak: 'break-word' }}>
        <Typography fontSize={13}>{titulo}</Typography>
        <Typography fontSize={11.5} color="text.secondary">
          {descricao}
        </Typography>
        <Typography fontSize={11} color="text.secondary">
          {dataHora(quando)} · {relativo(quando)}
        </Typography>
      </Box>
      <Typography
        fontSize={13}
        fontWeight={800}
        color={valor >= 0 ? '#0a9c97' : '#fe2c55'}
        sx={{ flexShrink: 0 }}
      >
        {valor >= 0 ? '+' : ''}
        {valor}
        {unidade}
      </Typography>
    </Stack>
  );
}

function Vazio() {
  return (
    <Typography fontSize={13} color="text.secondary">
      Nenhum lançamento ainda.
    </Typography>
  );
}

function Titulo({ children }: { children: string }) {
  return (
    <Typography fontWeight={700} fontSize={12.5} color="text.secondary" mb={1}>
      {children.toUpperCase()}
    </Typography>
  );
}

function Linha({
  rotulo,
  valor,
  detalhe,
  alerta,
}: {
  rotulo: string;
  valor: string;
  detalhe?: string;
  alerta?: boolean;
}) {
  return (
    <Stack direction="row" justifyContent="space-between" spacing={2} sx={{ py: 0.5 }}>
      <Typography fontSize={13} color="text.secondary" sx={{ flexShrink: 0 }}>
        {rotulo}
      </Typography>
      <Box sx={{ textAlign: 'right', minWidth: 0 }}>
        <Typography fontSize={13} fontWeight={600} sx={{ color: alerta ? 'warning.main' : undefined, wordBreak: 'break-word' }}>
          {valor}
        </Typography>
        {detalhe && (
          <Typography fontSize={11} color="text.secondary">
            {detalhe}
          </Typography>
        )}
      </Box>
    </Stack>
  );
}

function Tile({ n, rotulo, detalhe }: { n: number; rotulo: string; detalhe?: string }) {
  return (
    <Grid item xs={6}>
      <Box
        sx={{
          borderRadius: 2,
          border: '1px solid rgba(22,24,35,0.08)',
          px: 1.5,
          py: 1,
          height: '100%',
          opacity: n > 0 ? 1 : 0.6,
        }}
      >
        <Typography fontSize={20} fontWeight={800} lineHeight={1.2}>
          {n.toLocaleString('pt-BR')}
        </Typography>
        <Typography fontSize={12} color="text.secondary">
          {rotulo}
        </Typography>
        {detalhe && (
          <Typography fontSize={11} color="text.secondary" mt={0.25}>
            {detalhe}
          </Typography>
        )}
      </Box>
    </Grid>
  );
}
