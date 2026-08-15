import CardGiftcardIcon from '@mui/icons-material/CardGiftcard';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import PersonAddIcon from '@mui/icons-material/PersonAdd';
import ShareIcon from '@mui/icons-material/Share';
import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  Grid,
  TextField,
  Typography,
} from '@mui/material';
import { ReactNode, useEffect, useState } from 'react';
import { usersService } from '@/services/users.service';

interface Step {
  icon: ReactNode;
  title: string;
  description: string;
}

const STEPS: Step[] = [
  {
    icon: <ShareIcon color="primary" sx={{ fontSize: 36 }} />,
    title: 'Compartilhe seu link',
    description: 'Envie seu link exclusivo para amigos, grupos e seguidores.',
  },
  {
    icon: <PersonAddIcon color="primary" sx={{ fontSize: 36 }} />,
    title: 'Seu indicado assina',
    description: 'Quem assinar o PikPok pelo seu link fica vinculado a você.',
  },
  {
    icon: <CardGiftcardIcon color="primary" sx={{ fontSize: 36 }} />,
    title: 'Você ganha 40% todo mês',
    description: 'Enquanto a assinatura estiver ativa, a comissão é sua, recorrente.',
  },
];

const FAQ = [
  {
    q: 'Quando recebo?',
    a: 'As comissões fecham todo dia 1º e são pagas via Pix até o dia 10 do mês seguinte. Como o programa está em beta, o primeiro pagamento pode levar alguns dias a mais.',
  },
  {
    q: 'Tem limite de indicações?',
    a: 'Não. Você pode indicar quantas pessoas quiser e acumular 40% de cada assinatura ativa. Durante o beta, casos de volume muito alto passam por uma verificação rápida antisspam.',
  },
  {
    q: 'Como acompanho?',
    a: 'Um painel com cliques, assinaturas e comissões está em construção como parte do beta. Por enquanto, nosso suporte envia um extrato mensal com suas indicações e valores.',
  },
];

export function ReferralPage() {
  const [userId, setUserId] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    usersService
      .me()
      .then((u) => setUserId(u.id))
      .catch(console.error);
  }, []);

  const link = `https://pikpok.app/?ref=${userId ?? '...'}`;

  async function copy() {
    await navigator.clipboard.writeText(link);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <>
      <Typography variant="h5" gutterBottom>
        Indique e Ganhe
      </Typography>
      <Typography color="text.secondary" gutterBottom>
        Transforme sua rede em renda recorrente com o PikPok.
      </Typography>

      <Card
        sx={{
          my: 3,
          background: 'linear-gradient(135deg, #fe2c55 0%, #b91c3f 100%)',
          color: '#fff',
          border: 'none',
        }}
      >
        <CardContent sx={{ py: 4 }}>
          <Chip
            size="small"
            label="Programa em beta"
            sx={{ bgcolor: 'rgba(255,255,255,0.18)', color: '#fff', mb: 1.5 }}
          />
          <Typography variant="h4">40% de comissão recorrente, todo mês</Typography>
          <Typography sx={{ mt: 1, opacity: 0.9 }}>
            Cada assinatura ativa que vier do seu link paga comissão enquanto durar.
          </Typography>
        </CardContent>
      </Card>

      <Grid container spacing={2}>
        {STEPS.map((step) => (
          <Grid item xs={12} md={4} key={step.title}>
            <Card sx={{ height: '100%' }}>
              <CardContent>
                {step.icon}
                <Typography fontWeight={600} mt={1} gutterBottom>
                  {step.title}
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  {step.description}
                </Typography>
              </CardContent>
            </Card>
          </Grid>
        ))}
      </Grid>

      <Box my={3}>
        <Typography variant="h6" gutterBottom>
          Seu link de indicação
        </Typography>
        <Box display="flex" gap={1} flexWrap="wrap">
          <TextField
            size="small"
            value={link}
            InputProps={{ readOnly: true }}
            sx={{ flexGrow: 1, minWidth: { xs: '100%', sm: 260 } }}
          />
          <Button
            variant="contained"
            startIcon={<ContentCopyIcon />}
            onClick={copy}
            disabled={!userId}
          >
            {copied ? 'Copiado!' : 'Copiar'}
          </Button>
        </Box>
      </Box>

      <Typography variant="h6" gutterBottom>
        Perguntas frequentes
      </Typography>
      {FAQ.map((item) => (
        <Accordion key={item.q} disableGutters>
          <AccordionSummary expandIcon={<ExpandMoreIcon />}>
            <Typography fontWeight={600}>{item.q}</Typography>
          </AccordionSummary>
          <AccordionDetails>
            <Typography variant="body2" color="text.secondary">
              {item.a}
            </Typography>
          </AccordionDetails>
        </Accordion>
      ))}
    </>
  );
}
