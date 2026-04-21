
import React, { useEffect, useState } from 'react';
import { Container, Typography, Paper, Button, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, CircularProgress, Alert, Link } from '@mui/material';
import { getVisits, createVisit } from '../api';
import { Link as RouterLink } from 'react-router-dom';
import AddVisitDialog, { AddVisitFormData } from '../components/AddVisitDialog';
import { useAuth } from '../AuthContext';

interface Visit {
  id: string;
  status: string;
  scheduledStart: string;
  nurseId: string;
  doctorId?: string;
  createdAt: string;
}


  const { user } = useAuth();
  const [visits, setVisits] = useState<Visit[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);
  const [addLoading, setAddLoading] = useState(false);

  const fetchVisits = async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await getVisits();
      setVisits(data);
    } catch (err: any) {
      setError(err?.response?.data?.error || 'Failed to fetch visits');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchVisits();
  }, []);

  // Filter visits by user role
  let filteredVisits = visits;
  if (user) {
    if (user.role === 'PATIENT') {
      filteredVisits = visits.filter(v => v.patientId === user.id);
    } else if (user.role === 'NURSE') {
      filteredVisits = visits.filter(v => v.nurseId === user.id);
    } else if (user.role === 'DOCTOR') {
      filteredVisits = visits.filter(v => v.doctorId === user.id);
    }
    // Admin sees all
  }

  const handleAddVisit = async (form: AddVisitFormData) => {
    setAddLoading(true);
    setAddError(null);
    try {
      const newVisit = await createVisit({
        patientId: form.patientId,
        nurseId: form.nurseId,
        scheduledStart: form.scheduledStart,
        location: form.location,
      });
      setVisits((prev) => [newVisit, ...prev]);
      setAddDialogOpen(false);
    } catch (err: any) {
      setAddError(err?.response?.data?.error || 'Failed to add visit');
    } finally {
      setAddLoading(false);
    }
  };

  return (
    <Container maxWidth="md" sx={{ mt: 4 }}>
      <Paper elevation={3} sx={{ p: 4 }}>
        <Typography variant="h4" gutterBottom>
          Visits Management
        </Typography>
        <Typography variant="body1" gutterBottom>
          View and manage healthcare visits below.
        </Typography>
        <Button variant="contained" color="primary" sx={{ mb: 2 }} onClick={() => setAddDialogOpen(true)}>
          Add Visit
        </Button>
        {addError && <Alert severity="error">{addError}</Alert>}
        {loading ? (
          <CircularProgress />
        ) : error ? (
          <Alert severity="error">{error}</Alert>
        ) : (
          <TableContainer component={Paper}>
            <Table>
              <TableHead>
                <TableRow>
                  <TableCell>ID</TableCell>
                  <TableCell>Status</TableCell>
                  <TableCell>Scheduled Start</TableCell>
                  <TableCell>Nurse ID</TableCell>
                  <TableCell>Doctor ID</TableCell>
                  <TableCell>Created At</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {filteredVisits.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} align="center">No visits found.</TableCell>
                  </TableRow>
                ) : (
                  filteredVisits.map((visit) => (
                    <TableRow key={visit.id}>
                      <TableCell>
                        <Link component={RouterLink} to={`/visits/${visit.id}`}>{visit.id}</Link>
                      </TableCell>
                      <TableCell>{visit.status}</TableCell>
                      <TableCell>{new Date(visit.scheduledStart).toLocaleString()}</TableCell>
                      <TableCell>{visit.nurseId}</TableCell>
                      <TableCell>{visit.doctorId || '-'}</TableCell>
                      <TableCell>{new Date(visit.createdAt).toLocaleString()}</TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </TableContainer>
        )}
        <AddVisitDialog
          open={addDialogOpen}
          onClose={() => setAddDialogOpen(false)}
          onSubmit={handleAddVisit}
        />
      </Paper>
    </Container>
  );
}
