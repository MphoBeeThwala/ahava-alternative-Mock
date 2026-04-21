import React, { useState } from 'react';
import { Dialog, DialogTitle, DialogContent, DialogActions, Button, TextField, MenuItem } from '@mui/material';

interface AddVisitDialogProps {
  open: boolean;
  onClose: () => void;
  onSubmit: (data: AddVisitFormData) => void;
}

export interface AddVisitFormData {
  patientId: string;
  nurseId: string;
  scheduledStart: string;
  location: string;
}

export default function AddVisitDialog({ open, onClose, onSubmit }: AddVisitDialogProps) {
  const [form, setForm] = useState<AddVisitFormData>({
    patientId: '',
    nurseId: '',
    scheduledStart: '',
    location: '',
  });

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target as HTMLInputElement;
    setForm({ ...form, [name]: value });
  };

  const handleSubmit = () => {
    onSubmit(form);
  };

  return (
    <Dialog open={open} onClose={onClose}>
      <DialogTitle>Add New Visit</DialogTitle>
      <DialogContent>
        <TextField
          margin="dense"
          label="Patient ID"
          name="patientId"
          value={form.patientId}
          onChange={handleChange}
          fullWidth
          required
        />
        <TextField
          margin="dense"
          label="Nurse ID"
          name="nurseId"
          value={form.nurseId}
          onChange={handleChange}
          fullWidth
          required
        />
        <TextField
          margin="dense"
          label="Scheduled Start"
          name="scheduledStart"
          type="datetime-local"
          value={form.scheduledStart}
          onChange={handleChange}
          fullWidth
          required
          InputLabelProps={{ shrink: true }}
        />
        <TextField
          margin="dense"
          label="Location"
          name="location"
          value={form.location}
          onChange={handleChange}
          fullWidth
          required
        />
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button onClick={handleSubmit} variant="contained">Add</Button>
      </DialogActions>
    </Dialog>
  );
}
