import ChatRoundedIcon from '@mui/icons-material/ChatRounded';
import CloseRoundedIcon from '@mui/icons-material/CloseRounded';
import SendRoundedIcon from '@mui/icons-material/SendRounded';
import SupportAgentRoundedIcon from '@mui/icons-material/SupportAgentRounded';
import {
  Avatar,
  Box,
  Fab,
  Grow,
  IconButton,
  InputBase,
  Paper,
  Stack,
  Tooltip,
  Typography,
} from '@mui/material';
import { FormEvent, useEffect, useRef, useState } from 'react';
import { SupportMessage, supportService } from '@/services/support.service';

const red = '#fe2c55';
const cyan = '#25f4ee';

const WELCOME: SupportMessage = {
  id: 'welcome',
  sender: 'agent',
  text: 'Oi! 👋 Sou o suporte do PikPok. Conta pra gente o que você precisa — respondemos por aqui mesmo.',
  createdAt: '',
};

export function SupportFab() {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<SupportMessage[]>([WELCOME]);
  const [loaded, setLoaded] = useState(false);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [failed, setFailed] = useState(false);
  const [unread, setUnread] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  // Carrega o histórico real na primeira abertura.
  useEffect(() => {
    if (!open || loaded) return;
    supportService
      .list()
      .then((history) => {
        setMessages(history.length ? history : [WELCOME]);
        setLoaded(true);
      })
      .catch(() => setLoaded(true));
  }, [open, loaded]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, open, sending]);

  async function send(event: FormEvent) {
    event.preventDefault();
    const text = draft.trim();
    if (!text || sending) return;
    setDraft('');
    setFailed(false);
    setSending(true);
    // Mostra a mensagem imediatamente; o backend confirma na sequência.
    const optimistic: SupportMessage = {
      id: `local-${Date.now()}`,
      sender: 'user',
      text,
      createdAt: new Date().toISOString(),
    };
    setMessages((m) => [...m, optimistic]);
    try {
      const saved = await supportService.send(text);
      setMessages((m) => [...m.filter((msg) => msg.id !== optimistic.id), ...saved]);
      setUnread(true);
    } catch {
      setMessages((m) => m.filter((msg) => msg.id !== optimistic.id));
      setDraft(text);
      setFailed(true);
    } finally {
      setSending(false);
    }
  }

  return (
    <>
      {/* Janela do chat */}
      <Grow in={open} style={{ transformOrigin: 'bottom right' }}>
        <Paper
          elevation={12}
          sx={{
            position: 'fixed',
            bottom: { xs: 84, sm: 96 },
            right: { xs: 16, sm: 24 },
            zIndex: (t) => t.zIndex.drawer - 1,
            width: { xs: 'calc(100vw - 32px)', sm: 380 },
            height: { xs: 'calc(100vh - 116px)', sm: 480 },
            maxHeight: 'calc(100vh - 116px)',
            borderRadius: 4,
            overflow: 'hidden',
            display: 'flex',
            flexDirection: 'column',
          }}
        >
          {/* Cabeçalho */}
          <Stack
            direction="row"
            alignItems="center"
            spacing={1.5}
            sx={{
              px: 2,
              py: 1.5,
              color: '#fff',
              background: `linear-gradient(120deg, #161823, #2a1420), radial-gradient(80% 100% at 100% 0%, ${cyan}22, transparent)`,
            }}
          >
            <Avatar sx={{ width: 36, height: 36, background: `linear-gradient(135deg, ${red}, #ff7a9c)` }}>
              <SupportAgentRoundedIcon fontSize="small" />
            </Avatar>
            <Box flexGrow={1} minWidth={0}>
              <Typography fontWeight={700} fontSize={15} lineHeight={1.2}>
                Suporte PikPok
              </Typography>
              <Stack direction="row" spacing={0.7} alignItems="center">
                <Box sx={{ width: 7, height: 7, borderRadius: '50%', bgcolor: '#22c55e' }} />
                <Typography fontSize={12} sx={{ color: 'rgba(255,255,255,0.65)' }}>
                  online — respondemos por aqui
                </Typography>
              </Stack>
            </Box>
            <IconButton size="small" onClick={() => setOpen(false)} aria-label="Fechar chat" sx={{ color: 'rgba(255,255,255,0.7)' }}>
              <CloseRoundedIcon fontSize="small" />
            </IconButton>
          </Stack>

          {/* Mensagens */}
          <Box sx={{ flexGrow: 1, overflowY: 'auto', px: 2, py: 2, bgcolor: '#fafafa' }}>
            <Stack spacing={1.25}>
              {messages.map((m) => (
                <Box
                  key={m.id}
                  sx={{
                    alignSelf: m.sender === 'user' ? 'flex-end' : 'flex-start',
                    maxWidth: '82%',
                    px: 1.75,
                    py: 1,
                    fontSize: 14,
                    lineHeight: 1.5,
                    borderRadius: 3,
                    borderBottomRightRadius: m.sender === 'user' ? 6 : 12,
                    borderBottomLeftRadius: m.sender === 'user' ? 12 : 6,
                    color: m.sender === 'user' ? '#fff' : 'text.primary',
                    bgcolor: m.sender === 'user' ? red : '#fff',
                    border: m.sender === 'user' ? 'none' : '1px solid rgba(22,24,35,0.08)',
                    boxShadow: '0 1px 2px rgba(22,24,35,0.05)',
                    // Links e palavras longas não podem alargar o balão.
                    overflowWrap: 'anywhere',
                  }}
                >
                  {m.text}
                </Box>
              ))}
              {sending && (
                <Stack direction="row" spacing={0.5} sx={{ alignSelf: 'flex-start', px: 1.75, py: 1.2, bgcolor: '#fff', borderRadius: 3, border: '1px solid rgba(22,24,35,0.08)' }}>
                  {[0, 1, 2].map((i) => (
                    <Box
                      key={i}
                      sx={{
                        width: 6,
                        height: 6,
                        borderRadius: '50%',
                        bgcolor: 'rgba(22,24,35,0.35)',
                        animation: 'supportDot 1.2s ease infinite',
                        animationDelay: `${i * 0.18}s`,
                        '@keyframes supportDot': {
                          '0%, 60%, 100%': { transform: 'translateY(0)', opacity: 0.5 },
                          '30%': { transform: 'translateY(-4px)', opacity: 1 },
                        },
                      }}
                    />
                  ))}
                </Stack>
              )}
              {failed && (
                <Typography fontSize={12.5} color="error.main" sx={{ alignSelf: 'center' }}>
                  Não conseguimos enviar — verifique a conexão e tente de novo.
                </Typography>
              )}
            </Stack>
            <div ref={bottomRef} />
          </Box>

          {/* Input */}
          <Box
            component="form"
            onSubmit={send}
            sx={{
              display: 'flex',
              alignItems: 'center',
              gap: 1,
              px: 1.5,
              py: 1.25,
              borderTop: '1px solid rgba(22,24,35,0.08)',
              bgcolor: '#fff',
            }}
          >
            <InputBase
              fullWidth
              placeholder="Escreva sua mensagem…"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              sx={{ fontSize: 14.5, px: 1 }}
              inputProps={{ 'aria-label': 'Mensagem para o suporte' }}
            />
            <IconButton
              type="submit"
              disabled={!draft.trim() || sending}
              aria-label="Enviar"
              sx={{
                bgcolor: red,
                color: '#fff',
                '&:hover': { bgcolor: '#e0264c' },
                '&.Mui-disabled': { bgcolor: 'rgba(22,24,35,0.08)', color: 'rgba(22,24,35,0.3)' },
              }}
            >
              <SendRoundedIcon fontSize="small" />
            </IconButton>
          </Box>
        </Paper>
      </Grow>

      {/* Botão flutuante */}
      <Tooltip title={open ? 'Fechar chat' : 'Falar com o suporte'}>
        <Fab
          color="primary"
          onClick={() => {
            setOpen((v) => !v);
            setUnread(false);
          }}
          aria-label="Suporte"
          size="medium"
          sx={{
            position: 'fixed',
            bottom: { xs: 16, sm: 24 },
            right: { xs: 16, sm: 24 },
            zIndex: (t) => t.zIndex.drawer - 1,
          }}
        >
          {open ? <CloseRoundedIcon /> : <ChatRoundedIcon />}
          {unread && !open && (
            <Box
              sx={{
                position: 'absolute',
                top: 6,
                right: 6,
                width: 12,
                height: 12,
                borderRadius: '50%',
                bgcolor: cyan,
                border: '2px solid #fff',
              }}
            />
          )}
        </Fab>
      </Tooltip>
    </>
  );
}
