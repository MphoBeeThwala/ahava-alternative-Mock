import { BrowserRouter, Routes, Route, Navigate } from "react-router";
import { AuthProvider, useAuth } from "@/react-app/lib/auth-context";
import ProtectedLayout from "@/react-app/components/ProtectedLayout";

// Pages
import Home from "@/react-app/pages/Home";
import Login from "@/react-app/pages/Login";
import Signup from "@/react-app/pages/Signup";
import AuthCallback from "@/react-app/pages/AuthCallback";
import Onboarding from "@/react-app/pages/Onboarding";
import PatientDashboard from "@/react-app/pages/PatientDashboard";
import NurseDashboard from "@/react-app/pages/NurseDashboard";
import DoctorDashboard from "@/react-app/pages/DoctorDashboard";
import AdminDashboard from "@/react-app/pages/AdminDashboard";
import Payment from "@/react-app/pages/Payment";
import DiagnosticVault from "@/react-app/pages/DiagnosticVault";

/** Redirects a logged-in user to their role-appropriate dashboard */
function RoleRedirect() {
  const { user } = useAuth();
  if (!user) return <Navigate to="/login" replace />;
  const dest: Record<string, string> = {
    PATIENT: "/patient/dashboard",
    NURSE: "/nurse/dashboard",
    DOCTOR: "/doctor/dashboard",
    ADMIN: "/admin/dashboard",
  };
  return <Navigate to={dest[user.role] ?? "/onboarding"} replace />;
}

/** Only allows the listed roles; others are redirected to their own dashboard */
function RoleGuard({ roles, children }: { roles: string[]; children: React.ReactNode }) {
  const { user } = useAuth();
  if (!user) return <Navigate to="/login" replace />;
  if (!roles.includes(user.role)) return <RoleRedirect />;
  return <>{children}</>;
}

function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          {/* Public Routes */}
          <Route path="/" element={<Home />} />
          <Route path="/login" element={<Login />} />
          <Route path="/signup" element={<Signup />} />
          <Route path="/auth/callback" element={<AuthCallback />} />

          {/* Protected Routes */}
          <Route element={<ProtectedLayout />}>
            <Route path="/onboarding" element={<Onboarding />} />

            {/* Role-gated dashboards */}
            <Route path="/patient/dashboard" element={
              <RoleGuard roles={["PATIENT", "ADMIN"]}><PatientDashboard /></RoleGuard>
            } />
            <Route path="/nurse/dashboard" element={
              <RoleGuard roles={["NURSE", "ADMIN"]}><NurseDashboard /></RoleGuard>
            } />
            <Route path="/doctor/dashboard" element={
              <RoleGuard roles={["DOCTOR", "ADMIN"]}><DoctorDashboard /></RoleGuard>
            } />
            <Route path="/admin/dashboard" element={
              <RoleGuard roles={["ADMIN"]}><AdminDashboard /></RoleGuard>
            } />

            {/* Patient: Diagnostic Vault */}
            <Route path="/vault" element={
              <RoleGuard roles={["PATIENT", "ADMIN"]}><DiagnosticVault /></RoleGuard>
            } />

            {/* Features available to all authenticated roles */}
            <Route path="/payment" element={<Payment />} />
          </Route>

          {/* Catch-all - Redirect to Home */}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}

export default App;
