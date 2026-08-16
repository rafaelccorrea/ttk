import { Navigate, Outlet, Route, Routes } from 'react-router-dom';
import { AppLayout } from '@/components/layout/AppLayout';
import { PlanGate } from '@/components/ui/PlanGate';
import { RequireSubscription } from '@/components/ui/RequireSubscription';
import { AcademyPage } from '@/pages/Academy';
import { AnalyzePage } from '@/pages/Analyze';
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
            <Route path="/campanhas" element={<CampaignsPage />} />
            <Route path="/multiplicador" element={<MultiplierPage />} />
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
          </Route>
        </Route>
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
