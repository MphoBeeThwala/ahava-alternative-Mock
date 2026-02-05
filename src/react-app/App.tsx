import { BrowserRouter, Routes, Route, Navigate } from "react-router";
import { AuthProvider } from "@/react-app/lib/auth-context";
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

            {/* Dashboards */}
            <Route path="/patient/dashboard" element={<PatientDashboard />} />
            <Route path="/nurse/dashboard" element={<NurseDashboard />} />
            <Route path="/doctor/dashboard" element={<DoctorDashboard />} />
            <Route path="/admin/dashboard" element={<AdminDashboard />} />

            {/* Features */}
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
