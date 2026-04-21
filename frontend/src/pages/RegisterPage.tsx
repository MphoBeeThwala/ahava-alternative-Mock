import React, { useState } from 'react';
import { Container, Paper, Typography, TextField, Button, Alert, MenuItem } from '@mui/material';

const roles = [
  { value: 'PATIENT', label: 'Patient' },
  { value: 'NURSE', label: 'Nurse' },
  { value: 'DOCTOR', label: 'Doctor' },
  { value: 'ADMIN', label: 'Admin' },
];

export default function RegisterPage({ onRegister }: { onRegister?: () => void }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState('PATIENT');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      // @ts-ignore
      const { register } = await import('../api');
      const data = await register(email, password, role);
      // @ts-ignore
      const { useAuth } = await import('../AuthContext');
      // @ts-ignore
      const { login: setAuthUser } = useAuth();
      setAuthUser({
        id: data.user.id,
        email: data.user.email,
        role: data.user.role,
        token: data.token,
      });
      // Redirect based on role
      if (data.user.role === 'ADMIN') navigate('/dashboard');
      else if (data.user.role === 'NURSE') navigate('/dashboard');
      else if (data.user.role === 'DOCTOR') navigate('/dashboard');
      else navigate('/visits');
    } catch (err: any) {
      setError(err?.response?.data?.error || 'Registration failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Container maxWidth="xs" sx={{ mt: 8 }}>
      <Paper elevation={3} sx={{ p: 4 }}>
        <Typography variant="h5" gutterBottom>Register</Typography>
        <form onSubmit={handleSubmit}>
          <TextField label="Email" type="email" fullWidth margin="normal" value={email} onChange={e => setEmail(e.target.value)} required />
          <TextField label="Password" type="password" fullWidth margin="normal" value={password} onChange={e => setPassword(e.target.value)} required />
          <TextField select label="Role" fullWidth margin="normal" value={role} onChange={e => setRole(e.target.value)} required>
            {roles.map(r => <MenuItem key={r.value} value={r.value}>{r.label}</MenuItem>)}
          </TextField>
          {error && <Alert severity="error">{error}</Alert>}
          <Button type="submit" variant="contained" color="primary" fullWidth disabled={loading} sx={{ mt: 2 }}>
            {loading ? 'Registering...' : 'Register'}
          </Button>
        </form>
      </Paper>
    </Container>
  );
}
