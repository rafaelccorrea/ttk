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
import { useAuth } from '@/contexts/AuthContext';

const red = '#fe2c55';
const cyan = '#25f4ee';
const STORAGE_KEY = 'pikpok:support-chat';

interface ChatMessage {
  id: string;
  from: 'user' | 'agent';
  text: string;
  at: number;
}

const WELCOME: ChatMessage = {
  id: 'welcome',
  from: 'agent',
  text: 'Oi! 👋 Sou o suporte do PikPok. Conta pra gente o que você precisa — respondemos por aqui mesmo.',
  at: 0,
};

function loadMessages(): ChatMessage[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? (JSON.parse(raw) as ChatMessage[]) : [];
    return parsed.length ? parsed : [WELCOME];
  } catch {
    return [WELCOME];
  }
}

export function SupportFab() {
  const { email } = useAuth();
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>(loadMessages);
  const [draft, setDraft] = useState('');
  const [agentTyping, setAgentTyping] = useState(false);
  const [unread, setUnread] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(messages.slice(-100)));
    } catch {
      // storage cheio/indisponível: o chat segue funcionando em memória
    }
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, open, agentTyping]);

  function send(event: FormEvent) {
    event.preventDefault();
    const text = draft.trim();
    if (!text) return;
    setDraft('');
    setMessages((m) => [
      ...m,
      { id: crypto.randomUUID(), from: 'user', text, at: Date.now() },
    ]);
    // Confirmação automática enquanto não há atendente conectado.
    setAgentTyping(true);
    window.setTimeout(() => {
      setAgentTyping(false);
      setMessages((m) => [
        ...m,
        {
          id: crypto.randomUUID(),
          from: 'agent',
          text: `Recebemos sua mensagem! 🙌 Nossa equipe vai responder por aqui${email ? ` e avisar em ${email}` : ''} em até 1 dia útil.`,
          at: Date.now(),
        },
      ]);
      setUnread(true);
    }, 1400);
  }

  return (
    <>
      {/* Janela do chat */}
      <Grow in={open} style={{ transformOrigin: 'bottom right' }}>
        <Paper
          elevation={12}
          sx={{
            position: 'fixed',
            bottom: 96,
            right: 24,
            zIndex: (t) => t.zIndex.tooltip + 1,
            width: { xs: 'calc(100vw - 32px)', sm: 380 },
            height: 480,
            maxHeight: 'calc(100vh - 130px)',
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
            <Box flexGrow={1}>
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
                    alignSelf: m.from === 'user' ? 'flex-end' : 'flex-start',
                    maxWidth: '82%',
                    px: 1.75,
                    py: 1,
                    fontSize: 14,
                    lineHeight: 1.5,
                    borderRadius: 3,
                    borderBottomRightRadius: m.from === 'user' ? 6 : 12,
                    borderBottomLeftRadius: m.from === 'user' ? 12 : 6,
                    color: m.from === 'user' ? '#fff' : 'text.primary',
                    bgcolor: m.from === 'user' ? red : '#fff',
                    border: m.from === 'user' ? 'none' : '1px solid rgba(22,24,35,0.08)',
                    boxShadow: '0 1px 2px rgba(22,24,35,0.05)',
                  }}
                >
                  {m.text}
                </Box>
              ))}
              {agentTyping && (
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
              disabled={!draft.trim()}
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
          sx={{ position: 'fixed', bottom: 24, right: 24, zIndex: (t) => t.zIndex.tooltip + 1 }}
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
