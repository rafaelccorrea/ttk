import ChatBubbleOutlineIcon from '@mui/icons-material/ChatBubbleOutline';
import FavoriteBorderIcon from '@mui/icons-material/FavoriteBorder';
import PlayCircleIcon from '@mui/icons-material/PlayCircle';
import {
  Box,
  Button,
  Card,
  CardActionArea,
  CardContent,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Grid,
  Typography,
} from '@mui/material';
import { useState } from 'react';

type Level = 'Iniciante' | 'Intermediário' | 'Avançado';

interface Lesson {
  id: string;
  title: string;
  description: string;
  duration: string;
  level: Level;
  likes: number;
  comments: number;
  gradient: string;
}

interface Track {
  id: string;
  title: string;
  subtitle: string;
  lessons: Lesson[];
}

const TRACKS: Track[] = [
  {
    id: 'start',
    title: 'Comece por aqui',
    subtitle: 'O essencial para sair do zero no TikTok Shop.',
    lessons: [
      {
        id: 'start-1',
        title: 'Como funciona o TikTok Shop',
        description:
          'Entenda o ecossistema: vitrines, comissões e por que afiliados estão faturando.',
        duration: '6 min',
        level: 'Iniciante',
        likes: 328,
        comments: 41,
        gradient: 'linear-gradient(135deg, #fe2c55 0%, #ff7a59 100%)',
      },
      {
        id: 'start-2',
        title: 'Configurando sua conta de afiliado',
        description:
          'Passo a passo para liberar a vitrine, escolher produtos e receber comissões.',
        duration: '9 min',
        level: 'Iniciante',
        likes: 254,
        comments: 33,
        gradient: 'linear-gradient(135deg, #00c2bb 0%, #4fd1c5 100%)',
      },
      {
        id: 'start-3',
        title: 'Como usar o PikPok da forma correta',
        description:
          'Tour completo pela plataforma: monitorias, prompts e onde estão os atalhos.',
        duration: '7 min',
        level: 'Iniciante',
        likes: 412,
        comments: 58,
        gradient: 'linear-gradient(135deg, #161823 0%, #3b3d4a 100%)',
      },
    ],
  },
  {
    id: 'content',
    title: 'Conteúdo que vende',
    subtitle: 'Criativos que param o dedo e convertem em pedidos.',
    lessons: [
      {
        id: 'content-1',
        title: 'O gancho perfeito nos 3 primeiros segundos',
        description:
          'Fórmulas de abertura que seguram a retenção e disparam o algoritmo.',
        duration: '8 min',
        level: 'Intermediário',
        likes: 517,
        comments: 74,
        gradient: 'linear-gradient(135deg, #fe2c55 0%, #b91c3f 100%)',
      },
      {
        id: 'content-2',
        title: 'Estrutura Gancho-Corpo-CTA',
        description:
          'O roteiro de 3 blocos que organiza qualquer vídeo de produto.',
        duration: '11 min',
        level: 'Intermediário',
        likes: 389,
        comments: 52,
        gradient: 'linear-gradient(135deg, #7c3aed 0%, #fe2c55 100%)',
      },
      {
        id: 'content-3',
        title: 'Como não tomar punição com vídeos',
        description:
          'Palavras, claims e práticas que derrubam vídeos — e como evitá-las.',
        duration: '10 min',
        level: 'Intermediário',
        likes: 603,
        comments: 96,
        gradient: 'linear-gradient(135deg, #f59e0b 0%, #fe2c55 100%)',
      },
      {
        id: 'content-4',
        title: 'Multiplicando criativos para teste A/B',
        description:
          'Transforme 1 vídeo vencedor em 10 variações e escale o que performa.',
        duration: '12 min',
        level: 'Avançado',
        likes: 271,
        comments: 38,
        gradient: 'linear-gradient(135deg, #00c2bb 0%, #0284c7 100%)',
      },
    ],
  },
  {
    id: 'lives',
    title: 'Lives que convertem',
    subtitle: 'Transforme transmissões em máquina de vendas.',
    lessons: [
      {
        id: 'lives-1',
        title: 'Ciclos de live de 90 segundos',
        description:
          'A técnica de repetir pitch, demonstração e oferta a cada minuto e meio.',
        duration: '9 min',
        level: 'Intermediário',
        likes: 344,
        comments: 47,
        gradient: 'linear-gradient(135deg, #fe2c55 0%, #ec4899 100%)',
      },
      {
        id: 'lives-2',
        title: 'Respondendo o chat sem perder o ritmo',
        description:
          'Como interagir com a audiência mantendo o funil de venda rodando.',
        duration: '7 min',
        level: 'Intermediário',
        likes: 218,
        comments: 29,
        gradient: 'linear-gradient(135deg, #0ea5e9 0%, #00c2bb 100%)',
      },
      {
        id: 'lives-3',
        title: 'Checklist antes de abrir a live',
        description:
          'Luz, áudio, produtos fixados e metas — os 12 itens para não errar.',
        duration: '5 min',
        level: 'Iniciante',
        likes: 486,
        comments: 63,
        gradient: 'linear-gradient(135deg, #161823 0%, #fe2c55 100%)',
      },
    ],
  },
];

const LEVEL_COLOR: Record<Level, 'default' | 'secondary' | 'primary'> = {
  Iniciante: 'secondary',
  Intermediário: 'primary',
  Avançado: 'default',
};

function LessonCard({ lesson, onOpen }: { lesson: Lesson; onOpen: () => void }) {
  return (
    <Card sx={{ height: '100%' }}>
      <CardActionArea onClick={onOpen} sx={{ height: '100%', alignItems: 'stretch', display: 'flex', flexDirection: 'column' }}>
        <Box
          sx={{
            height: 120,
            background: lesson.gradient,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <PlayCircleIcon sx={{ fontSize: 52, color: 'rgba(255,255,255,0.92)' }} />
        </Box>
        <CardContent sx={{ flexGrow: 1, width: '100%' }}>
          <Box display="flex" gap={1} mb={1} flexWrap="wrap">
            <Chip size="small" label={lesson.duration} />
            <Chip
              size="small"
              variant="outlined"
              color={LEVEL_COLOR[lesson.level]}
              label={lesson.level}
            />
          </Box>
          <Typography fontWeight={600} gutterBottom>
            {lesson.title}
          </Typography>
          <Typography variant="body2" color="text.secondary" gutterBottom>
            {lesson.description}
          </Typography>
          <Box display="flex" gap={2} mt={1} color="text.secondary" alignItems="center">
            <Box display="flex" alignItems="center" gap={0.5}>
              <FavoriteBorderIcon sx={{ fontSize: 16 }} />
              <Typography variant="caption">{lesson.likes}</Typography>
            </Box>
            <Box display="flex" alignItems="center" gap={0.5}>
              <ChatBubbleOutlineIcon sx={{ fontSize: 16 }} />
              <Typography variant="caption">{lesson.comments}</Typography>
            </Box>
          </Box>
        </CardContent>
      </CardActionArea>
    </Card>
  );
}

export function AcademyPage() {
  const [openLesson, setOpenLesson] = useState<Lesson | null>(null);

  return (
    <>
      <Typography variant="h5" gutterBottom>
        PikPok Educa
      </Typography>
      <Typography color="text.secondary" gutterBottom>
        Aprenda a vender no TikTok Shop — aulas rápidas e direto ao ponto.
      </Typography>

      {TRACKS.map((track) => (
        <Box key={track.id} mt={4}>
          <Typography variant="h6">{track.title}</Typography>
          <Typography variant="body2" color="text.secondary" gutterBottom>
            {track.subtitle}
          </Typography>
          <Grid container spacing={2} mt={0}>
            {track.lessons.map((lesson) => (
              <Grid item xs={12} sm={6} md={4} key={lesson.id}>
                <LessonCard lesson={lesson} onOpen={() => setOpenLesson(lesson)} />
              </Grid>
            ))}
          </Grid>
        </Box>
      ))}

      <Dialog open={!!openLesson} onClose={() => setOpenLesson(null)} maxWidth="xs" fullWidth>
        <DialogTitle>{openLesson?.title}</DialogTitle>
        <DialogContent>
          <Typography color="text.secondary">
            Aula em produção — em breve 🎬
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setOpenLesson(null)}>Fechar</Button>
        </DialogActions>
      </Dialog>
    </>
  );
}
