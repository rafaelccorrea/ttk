import SendRoundedIcon from '@mui/icons-material/SendRounded';
import SupportAgentRoundedIcon from '@mui/icons-material/SupportAgentRounded';
import {
  Badge,
  Box,
  Card,
  CardContent,
  Chip,
  IconButton,
  InputBase,
  List,
  ListItemButton,
  ListItemText,
  Stack,
  Typography,
} from '@mui/material';
import { FormEvent, useCallback, useEffect, useRef, useState } from 'react';
import { apiErrorMessage } from '@/contexts/AuthContext';
import {
  adminService,
  type SupportChatMessage,
  type SupportConversation,
} from '@/services/admin.service';
import { dataHora, relativo } from './formato';

const red = '#fe2c55';
const POLL_MS = 15_000;

/**
 * Caixa de entrada do chat de suporte. Só o admin vê isto: a lista, a leitura
 * e a resposta batem em /admin/support/*, atrás do AdminGuard.
 */
export function SupportPanel() {
  const [conversas, setConversas] = useState<SupportConversation[]>([]);
  const [ativa, setAtiva] = useState<string | null>(null);
  const [mensagens, setMensagens] = useState<SupportChatMessage[]>([]);
  const [draft, setDraft] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  const carregarConversas = useCallback(async () => {
    try {
      setConversas(await adminService.supportConversas());
      setErro(null);
    } catch (e) {
      setErro(apiErrorMessage(e));
    }
  }, []);

  const carregarConversa = useCallback(async (userId: string) => {
    try {
      const d = await adminService.supportConversa(userId);
      setMensagens(d.mensagens);
    } catch (e) {
      setErro(apiErrorMessage(e));
    }
  }, []);

  // Lista e conversa aberta se atualizam sozinhas — é uma caixa de entrada.
  useEffect(() => {
    void carregarConversas();
    const t = setInterval(() => void carregarConversas(), POLL_MS);
    return () => clearInterval(t);
  }, [carregarConversas]);

  useEffect(() => {
    if (!ativa) return;
    void carregarConversa(ativa);
    const t = setInterval(() => void carregarConversa(ativa), POLL_MS);
    return () => clearInterval(t);
  }, [ativa, carregarConversa]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: 'end' });
  }, [mensagens]);

  async function responder(e: FormEvent) {
    e.preventDefault();
    const text = draft.trim();
    if (!text || !ativa || enviando) return;
    setEnviando(true);
    try {
      const m = await adminService.supportResponder(ativa, text);
      setMensagens((ms) => [...ms, m]);
      setDraft('');
      void carregarConversas();
    } catch (err) {
      setErro(apiErrorMessage(err));
    } finally {
      setEnviando(false);
    }
  }

  const naoLidas = conversas.reduce((n, c) => n + c.naoLidas, 0);
  const conversaAtiva = conversas.find((c) => c.userId === ativa) ?? null;

  return (
    <Card sx={{ mb: 3 }}>
      <CardContent>
        <Stack direction="row" alignItems="center" spacing={1} mb={1.5}>
          <Badge badgeContent={naoLidas} color="error">
            <SupportAgentRoundedIcon />
          </Badge>
          <Typography fontWeight={800} fontSize={17}>
            Suporte
          </Typography>
          <Typography fontSize={12.5} color="text.secondary">
            {conversas.length} conversa(s)
            {naoLidas > 0 ? ` · ${naoLidas} não lida(s)` : ''}
          </Typography>
        </Stack>
        {erro && (
          <Typography fontSize={12.5} color="error.main" mb={1}>
            {erro}
          </Typography>
        )}

        <Stack
          direction={{ xs: 'column', md: 'row' }}
          sx={{ border: '1px solid rgba(22,24,35,0.08)', borderRadius: 3, overflow: 'hidden', minHeight: 420 }}
        >
          {/* Lista de conversas */}
          <List
            dense
            disablePadding
            sx={{
              width: { xs: '100%', md: 320 },
              flexShrink: 0,
              maxHeight: { xs: 220, md: 520 },
              overflowY: 'auto',
              borderRight: { md: '1px solid rgba(22,24,35,0.08)' },
              borderBottom: { xs: '1px solid rgba(22,24,35,0.08)', md: 'none' },
            }}
          >
            {conversas.length === 0 && (
              <Typography color="text.secondary" fontSize={13.5} p={2} textAlign="center">
                Ninguém escreveu ao suporte ainda.
              </Typography>
            )}
            {conversas.map((c) => (
              <ListItemButton
                key={c.userId}
                selected={c.userId === ativa}
                onClick={() => {
                  setAtiva(c.userId);
                  setConversas((cs) =>
                    cs.map((x) => (x.userId === c.userId ? { ...x, naoLidas: 0 } : x)),
                  );
                }}
                sx={{ alignItems: 'flex-start' }}
              >
                <ListItemText
                  primary={
                    <Stack direction="row" alignItems="center" spacing={1}>
                      <Typography
                        fontSize={13.5}
                        fontWeight={c.naoLidas > 0 ? 800 : 600}
                        noWrap
                        sx={{ flex: 1, minWidth: 0 }}
                      >
                        {c.displayName || c.email || c.userId}
                      </Typography>
                      {c.naoLidas > 0 && (
                        <Chip size="small" color="error" label={c.naoLidas} sx={{ height: 18, fontSize: 11 }} />
                      )}
                    </Stack>
                  }
                  secondary={
                    <>
                      <Typography component="span" display="block" fontSize={12} noWrap color="text.secondary">
                        {c.ultimaMensagem}
                      </Typography>
                      <Typography component="span" fontSize={11} color="text.disabled">
                        {c.email && c.displayName ? `${c.email} · ` : ''}
                        {relativo(c.ultimaEm)}
                      </Typography>
                    </>
                  }
                />
              </ListItemButton>
            ))}
          </List>

          {/* Conversa */}
          <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
            {!ativa ? (
              <Typography color="text.secondary" fontSize={14} m="auto" p={3}>
                Escolha uma conversa para ler e responder.
              </Typography>
            ) : (
              <>
                <Box sx={{ px: 2, py: 1.25, borderBottom: '1px solid rgba(22,24,35,0.08)' }}>
                  <Typography fontWeight={700} fontSize={14}>
                    {conversaAtiva?.displayName || conversaAtiva?.email}
                  </Typography>
                  <Typography fontSize={12} color="text.secondary">
                    {conversaAtiva?.email}
                    {conversaAtiva?.plan ? ` · plano ${conversaAtiva.plan}` : ''}
                  </Typography>
                </Box>
                <Box sx={{ flex: 1, overflowY: 'auto', p: 2, bgcolor: '#fafafa', maxHeight: 400 }}>
                  <Stack spacing={1}>
                    {mensagens.map((m) => (
                      <Box
                        key={m.id}
                        sx={{
                          alignSelf: m.sender === 'agent' ? 'flex-end' : 'flex-start',
                          maxWidth: '78%',
                          px: 1.5,
                          py: 0.9,
                          fontSize: 13.5,
                          lineHeight: 1.5,
                          borderRadius: 2.5,
                          color: m.sender === 'agent' ? '#fff' : 'text.primary',
                          bgcolor: m.sender === 'agent' ? red : '#fff',
                          border: m.sender === 'agent' ? 'none' : '1px solid rgba(22,24,35,0.08)',
                          overflowWrap: 'anywhere',
                          whiteSpace: 'pre-wrap',
                        }}
                        title={dataHora(m.createdAt)}
                      >
                        {m.text}
                      </Box>
                    ))}
                  </Stack>
                  <div ref={bottomRef} />
                </Box>
                <Box
                  component="form"
                  onSubmit={responder}
                  sx={{ display: 'flex', gap: 1, alignItems: 'center', px: 1.5, py: 1, borderTop: '1px solid rgba(22,24,35,0.08)' }}
                >
                  <InputBase
                    fullWidth
                    multiline
                    maxRows={4}
                    placeholder="Responder ao usuário…"
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault();
                        void responder(e as unknown as FormEvent);
                      }
                    }}
                    sx={{ fontSize: 14, px: 1 }}
                  />
                  <IconButton
                    type="submit"
                    disabled={!draft.trim() || enviando}
                    aria-label="Enviar resposta"
                    sx={{ bgcolor: red, color: '#fff', '&:hover': { bgcolor: '#e0264c' } }}
                  >
                    <SendRoundedIcon fontSize="small" />
                  </IconButton>
                </Box>
              </>
            )}
          </Box>
        </Stack>
      </CardContent>
    </Card>
  );
}
