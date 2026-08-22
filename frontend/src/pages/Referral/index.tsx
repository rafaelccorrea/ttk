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
import { billingService, ReferralStats } from '@/services/billing.service';
import { usersService } from '@/services/users.service';

interface Step {
  icon: ReactNode;
  title: string;
  description: string;
}

// Fallback só para o primeiro render: os valores que valem vêm do backend
// (billing.config → REFERRAL_REWARD), para a página nunca anunciar um prêmio
// diferente do que o crédito real que cai na conta.
const PREMIO_PADRAO = { indicador: 100, indicado: 50 };

export function ReferralPage() {
  const [userId, setUserId] = useState<string | null>(null);
  const [stats, setStats] = useState<ReferralStats | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    usersService
      .me()
      .then((u) => setUserId(u.id))
      .catch(console.error);
    billingService.referrals().then(setStats).catch(console.error);
  }, []);

  const premio = stats?.recompensa ?? PREMIO_PADRAO;

  const steps: Step[] = [
    {
      icon: <ShareIcon color="primary" sx={{ fontSize: 36 }} />,
      title: 'Compartilhe seu link',
      description: 'Envie seu link exclusivo para amigos, grupos e seguidores.',
    },
    {
      icon: <PersonAddIcon color="primary" sx={{ fontSize: 36 }} />,
      title: 'Seu indicado paga',
      description:
        `Ele cria a conta pelo seu link e ganha ${premio.indicado} créditos de boas-vindas na primeira compra, além do que comprou.`,
    },
    {
      icon: <CardGiftcardIcon color="primary" sx={{ fontSize: 36 }} />,
      title: `Você ganha ${premio.indicador} créditos`,
      description:
        'Assim que o pagamento dele é confirmado — assinatura ou pacote de créditos.',
    },
  ];

  const faq = [
    {
      q: 'Quando os créditos entram?',
      a: `Na hora em que a primeira compra do seu indicado é confirmada pelo Stripe — assinatura ou pacote de créditos. Os ${premio.indicador} créditos aparecem no seu saldo e no extrato, em Planos & Créditos.`,
    },
    {
      q: 'E se a pessoa criar a conta mas não comprar nada?',
      a: 'Aí não há recompensa. O vínculo fica guardado: se ela pagar depois, os créditos entram nesse momento.',
    },
    {
      q: 'Tem limite de indicações?',
      a: 'Não. Cada indicado que paga rende créditos, e eles se acumulam. Casos de volume muito alto passam por uma verificação rápida antisspam.',
    },
    {
      q: 'A recompensa se repete a cada compra do meu indicado?',
      a: 'Não. É uma recompensa única por indicado, paga na primeira compra — renovações e pacotes seguintes não pagam de novo.',
    },
  ];

  const link = `${window.location.origin}/?ref=${userId ?? '...'}`;

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
        Convide quem vende no TikTok e ganhe créditos de IA a cada indicação que paga.
      </Typography>

      <Card
        sx={{
          my: 3,
          background: 'linear-gradient(135deg, #fe2c55 0%, #b91c3f 100%)',
          color: '#fff',
          border: 'none',
        }}
      >
        <CardContent sx={{ py: { xs: 3, md: 4 } }}>
          <Chip
            size="small"
            label="Programa em beta"
            sx={{ bgcolor: 'rgba(255,255,255,0.18)', color: '#fff', mb: 1.5 }}
          />
          <Typography variant="h4" sx={{ fontSize: { xs: 26, md: 34 } }}>
            {premio.indicador} créditos por indicação que paga
          </Typography>
          <Typography sx={{ mt: 1, opacity: 0.9 }}>
            E quem você indicar ganha {premio.indicado} créditos extras na
            primeira compra, além do que ela já traz.
          </Typography>
        </CardContent>
      </Card>

      {/* O painel: cliques não são medidos, então mostramos só o que o banco
          sabe de verdade — contas criadas, contas que pagaram e créditos. */}
      <Grid container spacing={2} mb={3}>
        {[
          { label: 'Indicados cadastrados', value: stats?.indicados },
          { label: 'Já pagaram', value: stats?.pagos },
          { label: 'Créditos ganhos', value: stats?.creditosGanhos },
        ].map((item) => (
          <Grid item xs={12} sm={4} key={item.label}>
            <Card sx={{ height: '100%' }}>
              <CardContent>
                <Typography variant="h4">{item.value ?? '—'}</Typography>
                <Typography variant="body2" color="text.secondary">
                  {item.label}
                </Typography>
              </CardContent>
            </Card>
          </Grid>
        ))}
      </Grid>

      <Grid container spacing={2}>
        {steps.map((step) => (
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
            sx={{ width: { xs: '100%', sm: 'auto' } }}
          >
            {copied ? 'Copiado!' : 'Copiar'}
          </Button>
        </Box>
      </Box>

      <Typography variant="h6" gutterBottom>
        Perguntas frequentes
      </Typography>
      {faq.map((item) => (
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
