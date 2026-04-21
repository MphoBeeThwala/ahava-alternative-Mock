import React, { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Container, Paper, Typography, CircularProgress, Alert, Box } from '@mui/material';
import { getVisits } from '../api';

export default function VisitDetailsPage() {
  const { id } = useParams();
  const [visit, setVisit] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        setLoading(true);
        setError(null);
        // For demo, fetch all and filter. Replace with getVisitById for real API.
        const visits = await getVisits();
        const found = visits.find((v: any) => v.id === id);
        setVisit(found);
      } catch (err: any) {
        setError('Failed to fetch visit details');
      } finally {
        setLoading(false);
      }
    })();
  }, [id]);

  if (loading) return <CircularProgress />;
  if (error) return <Alert severity="error">{error}</Alert>;
  if (!visit) return <Alert severity="info">Visit not found.</Alert>;

  return (
    <Container maxWidth="sm" sx={{ mt: 4 }}>
      <Paper elevation={3} sx={{ p: 4 }}>
        <Typography variant="h5" gutterBottom>Visit Details</Typography>
        <Box mb={2}>
          <Typography>ID: {visit.id}</Typography>
          <Typography>Status: {visit.status}</Typography>
          <Typography>Scheduled Start: {new Date(visit.scheduledStart).toLocaleString()}</Typography>
          <Typography>Nurse ID: {visit.nurseId}</Typography>
          <Typography>Doctor ID: {visit.doctorId || '-'}</Typography>
          <Typography>Created At: {new Date(visit.createdAt).toLocaleString()}</Typography>
        </Box>
        <Typography variant="h6" gutterBottom>Messages (Coming Soon)</Typography>
        <Alert severity="info">Messaging UI will be implemented here.</Alert>
      </Paper>
    </Container>
  );
}
