import { Navigate, Outlet, Route, Routes } from 'react-router-dom';
import { AppLayout } from '@/components/layout/AppLayout';
import { useAuth } from '@/contexts/AuthContext';
import { CreatorsPage } from '@/pages/Creators';
import { DashboardPage } from '@/pages/Dashboard';
import { FavoritesPage } from '@/pages/Favorites';
import { LandingPage } from '@/pages/Landing';
import { LoginPage } from '@/pages/Login';
import { ProfilePage } from '@/pages/Profile';
import { ProductDetailPage } from '@/pages/ProductDetail';
import { ProductsPage } from '@/pages/Products';
import { PromptsPage } from '@/pages/Prompts';
import { StudioPage } from '@/pages/Studio';
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
      <Route element={<ProtectedRoutes />}>
        <Route element={<AppLayout />}>
          <Route path="/dashboard" element={<DashboardPage />} />
          <Route path="/produtos" element={<ProductsPage />} />
          <Route path="/produtos/:id" element={<ProductDetailPage />} />
          <Route path="/videos" element={<VideosPage />} />
          <Route path="/criadores" element={<CreatorsPage />} />
          <Route path="/favoritos" element={<FavoritesPage />} />
          <Route path="/perfil" element={<ProfilePage />} />
          <Route path="/estudio" element={<StudioPage />} />
          <Route path="/prompts" element={<PromptsPage />} />
        </Route>
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
