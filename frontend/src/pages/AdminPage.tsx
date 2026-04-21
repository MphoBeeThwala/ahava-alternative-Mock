
import React, { useEffect, useState } from 'react';
import { Container, Paper, Typography, Table, TableHead, TableRow, TableCell, TableBody, Button, CircularProgress, Alert } from '@mui/material';
import { useAuth } from '../AuthContext';
import { getAllUsers } from '../api';

export default function AdminPage() {
  const { user } = useAuth();
  const [users, setUsers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!user || user.role !== 'ADMIN') return;
    (async () => {
      try {
        setLoading(true);
        setError(null);
        const data = await getAllUsers(user.token);
        setUsers(data);
      } catch (err: any) {
        setError(err?.response?.data?.error || 'Failed to fetch users');
      } finally {
        setLoading(false);
      }
    })();
  }, [user]);

  if (!user || user.role !== 'ADMIN') return null;
  return (
    <Container maxWidth="lg" sx={{ mt: 4 }}>
      <Paper elevation={3} sx={{ p: 4, mb: 4 }}>
        <Typography variant="h4" gutterBottom>Admin: User Management</Typography>
        {loading ? <CircularProgress /> : error ? <Alert severity="error">{error}</Alert> : (
          <Table>
            <TableHead>
              <TableRow>
                <TableCell>ID</TableCell>
                <TableCell>Email</TableCell>
                <TableCell>Role</TableCell>
                <TableCell>Actions</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {users.map(u => (
                <TableRow key={u.id}>
                  <TableCell>{u.id}</TableCell>
                  <TableCell>{u.email}</TableCell>
                  <TableCell>{u.role}</TableCell>
                  <TableCell>
                    <Button size="small" variant="outlined" disabled>Edit</Button>
                    <Button size="small" variant="outlined" color="error" disabled sx={{ ml: 1 }}>Delete</Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Paper>
      <Paper elevation={3} sx={{ p: 4 }}>
        <Typography variant="h5" gutterBottom>Analytics (Placeholder)</Typography>
        <Typography>Total Users: {users.length}</Typography>
        <Typography>Visits Today: --</Typography>
        <Typography>Payments Processed: --</Typography>
      </Paper>
    </Container>
  );
}
