import { Box, GlobalStyles } from '@mui/material';
import { ReactNode, useEffect, useRef, useState } from 'react';

// Paleta local da landing: página dark independente do tema claro do app.
export const ink = '#08090f';
export const inkSoft = '#0e1018';
export const inkCard = '#12141d';
export const line = 'rgba(255,255,255,0.08)';
export const lineStrong = 'rgba(255,255,255,0.16)';
export const textDim = 'rgba(255,255,255,0.64)';
export const textFaint = 'rgba(255,255,255,0.42)';
export const red = '#fe2c55';
export const cyan = '#25f4ee';
export const violet = '#8b5cf6';

export const gradientText = {
  background: `linear-gradient(92deg, ${red} 0%, #ff7a9c 45%, ${cyan} 100%)`,
  backgroundSize: '200% 100%',
  WebkitBackgroundClip: 'text',
  WebkitTextFillColor: 'transparent',
  animation: 'lpGradient 6s ease infinite',
} as const;

export const glass = {
  border: `1px solid ${line}`,
  borderRadius: 4,
  background: 'linear-gradient(180deg, rgba(255,255,255,0.05) 0%, rgba(255,255,255,0.02) 100%)',
  backdropFilter: 'blur(12px)',
} as const;

/** Card com borda em gradiente que acende no hover. */
export const glowCard = {
  ...glass,
  position: 'relative',
  overflow: 'hidden',
  transition: 'transform .25s ease, border-color .25s ease, box-shadow .25s ease',
  '&:hover': {
    transform: 'translateY(-6px)',
    borderColor: `${red}55`,
    boxShadow: `0 22px 54px rgba(0,0,0,0.5), 0 0 0 1px ${red}22`,
  },
} as const;

export const landingKeyframes = (
  <GlobalStyles
    styles={`
      html { scroll-behavior: smooth; }
      @keyframes lpGradient { 0%,100% { background-position: 0% 50%; } 50% { background-position: 100% 50%; } }
      @keyframes lpFadeUp { from { opacity: 0; transform: translateY(28px); } to { opacity: 1; transform: translateY(0); } }
      @keyframes lpFloat { 0%,100% { transform: translateY(0); } 50% { transform: translateY(-12px); } }
      @keyframes lpFloatAlt { 0%,100% { transform: translateY(-6px) rotate(-2deg); } 50% { transform: translateY(8px) rotate(2deg); } }
      @keyframes lpPulse { 0%,100% { box-shadow: 0 0 0 0 rgba(254,44,85,0.55); } 70% { box-shadow: 0 0 0 9px rgba(254,44,85,0); } }
      @keyframes lpMarquee { from { transform: translateX(0); } to { transform: translateX(-50%); } }
      @keyframes lpMarqueeBack { from { transform: translateX(-50%); } to { transform: translateX(0); } }
      @keyframes lpBar { from { width: 0; } }
      @keyframes lpBlob { 0%,100% { transform: translate(0,0) scale(1); } 33% { transform: translate(40px,-30px) scale(1.12); } 66% { transform: translate(-30px,24px) scale(0.94); } }
      @keyframes lpShine { from { transform: translateX(-120%) skewX(-18deg); } to { transform: translateX(240%) skewX(-18deg); } }
      @keyframes lpTicker { 0%, 18% { transform: translateY(0); } 25%, 43% { transform: translateY(-25%); } 50%, 68% { transform: translateY(-50%); } 75%, 93% { transform: translateY(-75%); } 100% { transform: translateY(-75%); } }
      @keyframes lpCaret { 0%,100% { opacity: 1; } 50% { opacity: 0; } }
      @keyframes lpSpin { to { transform: rotate(360deg); } }
      @keyframes lpScan { 0% { transform: translateY(-100%); } 100% { transform: translateY(900%); } }
      @media (prefers-reduced-motion: reduce) {
        html { scroll-behavior: auto; }
        *, *::before, *::after { animation-duration: 0.001s !important; animation-iteration-count: 1 !important; }
      }
    `}
  />
);

/** Revela o conteúdo com fade-up quando entra no viewport. */
export function Reveal({ children, delay = 0 }: { children: ReactNode; delay?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setShown(true);
          obs.disconnect();
        }
      },
      { threshold: 0.12 },
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, []);
  return (
    <Box
      ref={ref}
      sx={{
        opacity: shown ? 1 : 0,
        transform: shown ? 'none' : 'translateY(32px)',
        transition: `opacity .7s ease ${delay}ms, transform .7s cubic-bezier(.2,.8,.2,1) ${delay}ms`,
      }}
    >
      {children}
    </Box>
  );
}

/** Conta de 0 até `to` quando a seção aparece — usado nas métricas. */
export function useCountUp(to: number, duration = 1400) {
  const ref = useRef<HTMLSpanElement>(null);
  const [value, setValue] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting) return;
        obs.disconnect();
        const start = performance.now();
        const tick = (now: number) => {
          const p = Math.min(1, (now - start) / duration);
          setValue(to * (1 - Math.pow(1 - p, 3)));
          if (p < 1) requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      },
      { threshold: 0.4 },
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [to, duration]);
  return { ref, value };
}

/** Título de seção padronizado (eyebrow + headline + subtítulo). */
export function SectionHeading({
  eyebrow,
  title,
  subtitle,
  align = 'center',
}: {
  eyebrow: string;
  title: ReactNode;
  subtitle?: ReactNode;
  align?: 'center' | 'left';
}) {
  return (
    <Box textAlign={align} mb={7} maxWidth={align === 'center' ? 760 : undefined} mx={align === 'center' ? 'auto' : 0}>
      <Box
        component="p"
        sx={{ color: cyan, fontWeight: 700, letterSpacing: '0.14em', fontSize: 13, m: 0 }}
      >
        {eyebrow}
      </Box>
      <Box
        component="h2"
        sx={{ fontSize: { xs: 30, md: 42 }, fontWeight: 800, letterSpacing: '-0.025em', mt: 1.5, mb: 0, lineHeight: 1.12 }}
      >
        {title}
      </Box>
      {subtitle && (
        <Box component="p" sx={{ color: textDim, fontSize: 17, mt: 2, lineHeight: 1.65, mb: 0 }}>
          {subtitle}
        </Box>
      )}
    </Box>
  );
}
