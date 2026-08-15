import { Box } from '@mui/material';
import { Navigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { Hero } from './Hero';
import { Navbar } from './Navbar';
import {
  Comparison,
  Faq,
  Features,
  FinalCta,
  Footer,
  HowItWorks,
  NichesMarquee,
  Pricing,
  Showcase,
  Testimonials,
} from './Sections';
import { cyan, ink, landingKeyframes, red, textMain } from './theme';

export function LandingPage() {
  const { isAuthenticated } = useAuth();
  if (isAuthenticated) return <Navigate to="/dashboard" replace />;

  return (
    <Box sx={{ bgcolor: ink, color: textMain, minHeight: '100vh', overflowX: 'hidden', position: 'relative' }}>
      {landingKeyframes}

      {/* Fundo: grade de pontos + blobs animados */}
      <Box
        aria-hidden
        sx={{
          position: 'absolute', inset: 0, pointerEvents: 'none',
          backgroundImage: 'radial-gradient(rgba(11,12,18,0.10) 1px, transparent 1px)',
          backgroundSize: '28px 28px',
          maskImage: 'linear-gradient(180deg, rgba(0,0,0,0.55), transparent 55%)',
        }}
      />
      <Box aria-hidden sx={{ position: 'absolute', top: -120, left: -80, width: 480, height: 480, borderRadius: '50%', filter: 'blur(120px)', background: `${red}22`, animation: 'lpBlob 16s ease-in-out infinite', pointerEvents: 'none' }} />
      <Box aria-hidden sx={{ position: 'absolute', top: 120, right: -140, width: 420, height: 420, borderRadius: '50%', filter: 'blur(120px)', background: `${cyan}33`, animation: 'lpBlob 20s ease-in-out infinite reverse', pointerEvents: 'none' }} />

      <Navbar />
      <Hero />
      <NichesMarquee />
      <Features />
      <Showcase />
      <HowItWorks />
      <Comparison />
      <Testimonials />
      <Pricing />
      <Faq />
      <FinalCta />
      <Footer />
    </Box>
  );
}
