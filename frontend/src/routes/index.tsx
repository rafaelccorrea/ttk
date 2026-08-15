import { Navigate, Outlet, Route, Routes } from 'react-router-dom';
import { AppLayout } from '@/components/layout/AppLayout';
import { AcademyPage } from '@/pages/Academy';
import { useAuth } from '@/contexts/AuthContext';
import { ConfirmEmailPage } from '@/pages/ConfirmEmail';
import { CreatorsPage } from '@/pages/Creators';
import { DashboardPage } from '@/pages/Dashboard';
import { FavoritesPage } from '@/pages/Favorites';
import { GenerationsPage } from '@/pages/Generations';
import { LandingPage } from '@/pages/Landing';
import { LoginPage } from '@/pages/Login';
import { MultiplierPage } from '@/pages/Multiplier';
import { ProfilePage } from '@/pages/Profile';
import { ReferralPage } from '@/pages/Referral';
import { ProductDetailPage } from '@/pages/ProductDetail';
import { ProductsPage } from '@/pages/Products';
import { PromptsPage } from '@/pages/Prompts';
import { StudioPage } from '@/pages/Studio';
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
      <Route element={<ProtectedRoutes />}>
        <Route element={<AppLayout />}>
          <Route path="/dashboard" element={<DashboardPage />} />
          <Route path="/produtos" element={<ProductsPage />} />
          <Route path="/produtos/:id" element={<ProductDetailPage />} />
          <Route path="/videos" element={<VideosPage />} />
          <Route path="/tendencias" element={<TrendsPage />} />
          <Route path="/criadores" element={<CreatorsPage />} />
          <Route path="/favoritos" element={<FavoritesPage />} />
          <Route path="/perfil" element={<ProfilePage />} />
          <Route path="/estudio" element={<StudioPage />} />
          <Route path="/multiplicador" element={<MultiplierPage />} />
          <Route path="/academy" element={<AcademyPage />} />
          <Route path="/indique" element={<ReferralPage />} />
          <Route path="/prompts" element={<PromptsPage />} />
          <Route path="/geracoes" element={<GenerationsPage />} />
        </Route>
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
