import React from 'react';
import { Container, Paper, Typography } from '@mui/material';
import { useAuth } from '../AuthContext';

export default function ProfilePage() {
  const { user } = useAuth();
  if (!user) return null;
  return (
    <Container maxWidth="sm" sx={{ mt: 6 }}>
      <Paper elevation={3} sx={{ p: 4 }}>
        <Typography variant="h5" gutterBottom>Profile</Typography>
        <Typography>Email: {user.email}</Typography>
        <Typography>Role: {user.role}</Typography>
        <Typography>User ID: {user.id}</Typography>
      </Paper>
    </Container>
  );
}
