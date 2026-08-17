import { Navigate, Outlet, Route, Routes } from 'react-router-dom';
import { AppLayout } from '@/components/layout/AppLayout';
import { PlanGate } from '@/components/ui/PlanGate';
import { RequireSubscription } from '@/components/ui/RequireSubscription';
import { AcademyPage } from '@/pages/Academy';
import { AdminPage } from '@/pages/Admin';
import { AnalyzePage } from '@/pages/Analyze';
import { AtivarDispositivoPage } from '@/pages/AtivarDispositivo';
import { useAuth } from '@/contexts/AuthContext';
import { CampaignsPage } from '@/pages/Campaigns';
import { ConfirmEmailPage } from '@/pages/ConfirmEmail';
import { CreatorsPage } from '@/pages/Creators';
import { DashboardPage } from '@/pages/Dashboard';
import { FavoritesPage } from '@/pages/Favorites';
import { ForgotPasswordPage } from '@/pages/ForgotPassword';
import { ResetPasswordPage } from '@/pages/ResetPassword';
import { GenerationsPage } from '@/pages/Generations';
import { IngestionPage } from '@/pages/Ingestion';
import { LandingPage } from '@/pages/Landing';
import { LivePage } from '@/pages/Live';
import { LiveDetailPage } from '@/pages/Live/Detail';
import { LoginPage } from '@/pages/Login';
import { MultiplierPage } from '@/pages/Multiplier';
import { PlansPage } from '@/pages/Plans';
import { ProfilePage } from '@/pages/Profile';
import { ReferralPage } from '@/pages/Referral';
import { ProductDetailPage } from '@/pages/ProductDetail';
import { ProductsPage } from '@/pages/Products';
import { PromptsPage } from '@/pages/Prompts';
import { StudioPage } from '@/pages/Studio';
import { SubscribePage } from '@/pages/Subscribe';
import { TrendsPage } from '@/pages/Trends';
import { VideosPage } from '@/pages/Videos';

function ProtectedRoutes() {
  const { isAuthenticated, isLoading } = useAuth();
  if (isLoading) return null;
  if (!isAuthenticated) return <Navigate to="/login" replace />;
  return <Outlet />;
}

export function AppRoutes() {
  return (
    <Routes>
      <Route path="/" element={<LandingPage />} />
      <Route path="/login" element={<LoginPage />} />
      <Route path="/confirmar-email" element={<ConfirmEmailPage />} />
      <Route path="/esqueci-a-senha" element={<ForgotPasswordPage />} />
      <Route path="/redefinir-senha" element={<ResetPasswordPage />} />
      <Route element={<ProtectedRoutes />}>
        {/* Fora do AppLayout de propósito: quem não tem assinatura não vê o
            app por trás, só a tela de pagamento. */}
        <Route path="/assinatura" element={<SubscribePage />} />
        {/* Aprovação do app desktop. Exige login (é a sessão da web que diz de
            quem é a conta), mas não passa pelo RequireSubscription: a tela é
            uma decisão de segurança e tem que abrir mesmo com a assinatura
            vencida — inclusive para recusar um pedido que não foi seu. */}
        <Route path="/ativar" element={<AtivarDispositivoPage />} />
        <Route element={<AppLayout />}>
          {/* Estar logado não basta: conta sem assinatura vai para /planos. */}
          <Route element={<RequireSubscription />}>
            <Route path="/dashboard" element={<DashboardPage />} />
            <Route path="/produtos" element={<ProductsPage />} />
            <Route path="/produtos/:id" element={<ProductDetailPage />} />
            <Route path="/videos" element={<VideosPage />} />
            <Route path="/tendencias" element={<TrendsPage />} />
            <Route path="/criadores" element={<CreatorsPage />} />
            <Route path="/favoritos" element={<FavoritesPage />} />
            <Route path="/perfil" element={<ProfilePage />} />
            <Route path="/estudio" element={<StudioPage />} />
            {/* Campanhas e Multiplicador são Pro no backend; sem o gate aqui,
                quem assina o Essencial abria a tela e só descobria no 403. */}
            <Route
              path="/campanhas"
              element={
                <PlanGate feature="campaigns">
                  <CampaignsPage />
                </PlanGate>
              }
            />
            <Route
              path="/multiplicador"
              element={
                <PlanGate feature="multiplier">
                  <MultiplierPage />
                </PlanGate>
              }
            />
            {/* Live Copilot é gate de plano no backend (`live_copilot`); sem o
                PlanGate aqui a tela abriria e só o 403 explicaria o porquê. */}
            <Route
              path="/copiloto"
              element={
                <PlanGate feature="live_copilot">
                  <LivePage />
                </PlanGate>
              }
            />
            <Route
              path="/copiloto/:id"
              element={
                <PlanGate feature="live_copilot">
                  <LiveDetailPage />
                </PlanGate>
              }
            />
            <Route path="/academy" element={<AcademyPage />} />
            <Route path="/indique" element={<ReferralPage />} />
            <Route path="/prompts" element={<PromptsPage />} />
            <Route path="/geracoes" element={<GenerationsPage />} />
            <Route
              path="/coleta"
              element={
                <PlanGate feature="ingestion">
                  <IngestionPage />
                </PlanGate>
              }
            />
            <Route path="/analisar" element={<AnalyzePage />} />
            <Route path="/planos" element={<PlansPage />} />
            {/* A rota existe para qualquer logado; quem barra é o AdminGuard
                do backend, que responde 403 em todas as chamadas /admin. */}
            <Route path="/admin" element={<AdminPage />} />
          </Route>
        </Route>
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
