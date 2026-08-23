import PersonAddAlt1RoundedIcon from '@mui/icons-material/PersonAddAlt1Rounded';
import { Alert, Button, Snackbar } from '@mui/material';
import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '@/services/api';

const INTERVALO_MS = 60_000;
const CHAVE = 'pikpok.admin.novasContasDesde';

interface ContaNova {
  id: string;
  email: string;
  displayName: string | null;
  viaGoogle: boolean;
  naFila: boolean;
  createdAt: string;
}

/**
 * Toast para a equipe quando uma conta nova é criada.
 *
 * Pergunta ao servidor de minuto em minuto o que nasceu depois da última
 * data vista — guardada no navegador, para um reload não engolir o aviso. O
 * backend limita a 24 h para trás, então voltar de férias não vira uma
 * enxurrada. Só é montado para admin (ver AppLayout); o backend barra o resto.
 */
export function NovasContasToast() {
  const navigate = useNavigate();
  const [fila, setFila] = useState<ContaNova[]>([]);
  const desdeRef = useRef<string>(lerDesde());

  useEffect(() => {
    let ativo = true;
    const consultar = async () => {
      try {
        const { data } = await api.get<{ agora: string; contas: ContaNova[] }>(
          '/admin/novas-contas',
          { params: { desde: desdeRef.current } },
        );
        if (!ativo) return;
        desdeRef.current = data.agora;
        localStorage.setItem(CHAVE, data.agora);
        if (data.contas.length) setFila((f) => [...f, ...data.contas]);
      } catch {
        // Silencioso: é um aviso de conveniência, não pode virar erro na tela.
      }
    };
    void consultar();
    const t = setInterval(() => void consultar(), INTERVALO_MS);
    return () => {
      ativo = false;
      clearInterval(t);
    };
  }, []);

  const atual = fila[0];
  const restantes = fila.length - 1;
  if (!atual) return null;

  const quem = atual.displayName ? `${atual.displayName} (${atual.email})` : atual.email;
  const detalhes = [atual.viaGoogle ? 'via Google' : 'por e-mail', atual.naFila ? 'na fila' : null]
    .filter(Boolean)
    .join(' · ');

  return (
    <Snackbar
      key={atual.id}
      open
      autoHideDuration={8000}
      onClose={(_, motivo) => {
        if (motivo === 'clickaway') return;
        setFila((f) => f.slice(1));
      }}
      anchorOrigin={{ vertical: 'top', horizontal: 'right' }}
    >
      <Alert
        severity="info"
        variant="filled"
        icon={<PersonAddAlt1RoundedIcon fontSize="inherit" />}
        onClose={() => setFila((f) => f.slice(1))}
        action={
          <Button
            color="inherit"
            size="small"
            onClick={() => {
              setFila([]);
              navigate('/admin');
            }}
          >
            Ver
          </Button>
        }
        sx={{ maxWidth: 420, alignItems: 'center' }}
      >
        <strong>Nova conta:</strong> {quem} — {detalhes}
        {restantes > 0 ? ` (+${restantes})` : ''}
      </Alert>
    </Snackbar>
  );
}

function lerDesde(): string {
  try {
    const salvo = localStorage.getItem(CHAVE);
    if (salvo && !Number.isNaN(new Date(salvo).getTime())) return salvo;
  } catch {
    // Sem storage (modo privado): começa de agora.
  }
  return new Date().toISOString();
}
