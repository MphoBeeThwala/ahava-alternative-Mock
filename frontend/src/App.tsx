import React from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';


import AppThemeProvider from './AppThemeProvider';
import VisitsPage from './pages/VisitsPage';
import Dashboard from './pages/Dashboard';
import NavBar from './NavBar';

import LoginPage from './pages/LoginPage';
import RegisterPage from './pages/RegisterPage';
import ProfilePage from './pages/ProfilePage';
import AdminPage from './pages/AdminPage';
import VisitDetailsPage from './pages/VisitDetailsPage';
import EarlyWarningPage from './pages/EarlyWarningPage';
import { AuthProvider, useAuth } from './AuthContext';


function ProtectedRoute({ children }: { children: JSX.Element }) {
  const { user } = useAuth();
  if (!user) return <Navigate to="/login" replace />;
  return children;
}

export default function App() {
  return (
    <AppThemeProvider>
      <AuthProvider>
        <Router>
          <NavBar />
          <Routes>
            <Route path="/login" element={<LoginPage />} />
            <Route path="/register" element={<RegisterPage />} />
            <Route path="/" element={<Navigate to="/visits" replace />} />
            <Route path="/visits" element={<ProtectedRoute><VisitsPage /></ProtectedRoute>} />
            <Route path="/visits/:id" element={<ProtectedRoute><VisitDetailsPage /></ProtectedRoute>} />
            <Route path="/dashboard" element={<ProtectedRoute><Dashboard /></ProtectedRoute>} />
            <Route path="/early-warning" element={<ProtectedRoute><EarlyWarningPage /></ProtectedRoute>} />
            <Route path="/profile" element={<ProtectedRoute><ProfilePage /></ProtectedRoute>} />
            <Route path="/admin" element={<ProtectedRoute><AdminPage /></ProtectedRoute>} />
          </Routes>
        </Router>
      </AuthProvider>
    </AppThemeProvider>
  );
}
