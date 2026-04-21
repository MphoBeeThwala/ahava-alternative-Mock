
import React from 'react';
import { Container, Typography, Paper } from '@mui/material';
import { useAuth } from '../AuthContext';

export default function Dashboard() {
  const { user } = useAuth();
  let content = null;
  if (!user) return null;
  if (user.role === 'ADMIN') {
    content = <Typography>Welcome, Admin! Here you can manage users and view analytics.</Typography>;
  } else if (user.role === 'NURSE') {
    content = <Typography>Welcome, Nurse! Here are your assigned visits and patient info.</Typography>;
  } else if (user.role === 'DOCTOR') {
    content = <Typography>Welcome, Doctor! Here are your oversight visits and reports.</Typography>;
  } else {
    content = <Typography>Welcome, Patient! Here you can view and book your visits.</Typography>;
  }
  return (
    <Container maxWidth="md" sx={{ mt: 4 }}>
      <Paper elevation={3} sx={{ p: 4 }}>
        <Typography variant="h4" gutterBottom>
          Dashboard
        </Typography>
        {content}
      </Paper>
    </Container>
  );
}
