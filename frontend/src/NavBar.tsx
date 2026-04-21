
import React from 'react';
import { AppBar, Toolbar, Typography, Button, Box } from '@mui/material';
import { Link as RouterLink, useNavigate } from 'react-router-dom';
import { useAuth } from './AuthContext';

export default function NavBar() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  return (
    <AppBar position="static">
      <Toolbar>
        <Typography variant="h6" sx={{ flexGrow: 1 }}>
          Ahava Healthcare
        </Typography>
        {user && (
          <>
            <Button color="inherit" component={RouterLink} to="/visits">
              Visits
            </Button>
            <Button color="inherit" component={RouterLink} to="/dashboard">
              Dashboard
            </Button>
            <Button 
              color="inherit" 
              component={RouterLink} 
              to="/early-warning"
              sx={{ 
                backgroundColor: 'rgba(255,255,255,0.2)',
                '&:hover': { backgroundColor: 'rgba(255,255,255,0.3)' }
              }}
            >
              🏥 Early Warning
            </Button>
            {user.role === 'ADMIN' && (
              <Button color="inherit" component={RouterLink} to="/admin">Admin</Button>
            )}
            <Button color="inherit" component={RouterLink} to="/profile">Profile</Button>
            <Box sx={{ mx: 2 }}>{user.email} ({user.role})</Box>
            <Button color="inherit" onClick={handleLogout}>
              Logout
            </Button>
          </>
        )}
        {!user && (
          <>
            <Button color="inherit" component={RouterLink} to="/login">Login</Button>
            <Button color="inherit" component={RouterLink} to="/register">Register</Button>
          </>
        )}
      </Toolbar>
    </AppBar>
  );
}
