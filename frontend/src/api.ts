// ADMIN
export async function getAllUsers(token: string) {
  const res = await axios.get(`${API_BASE_URL}/admin/users`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return res.data.users;
}
// AUTH
export async function login(email: string, password: string) {
  const res = await axios.post(`${API_BASE_URL}/auth/login`, { email, password });
  return res.data;
}

export async function register(email: string, password: string, role: string) {
  const res = await axios.post(`${API_BASE_URL}/auth/register`, { email, password, role });
  return res.data;
}
import axios from 'axios';

const API_BASE_URL =
  typeof import.meta !== 'undefined' && (import.meta as any).env && (import.meta as any).env.VITE_API_URL
    ? (import.meta as any).env.VITE_API_URL
    : 'http://localhost:3000';

export async function getVisits(token?: string) {
  const res = await axios.get(`${API_BASE_URL}/visits`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  return res.data.visits;
}

export async function createVisit(data: any, token?: string) {
  const res = await axios.post(`${API_BASE_URL}/visits`, data, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  return res.data.visit;
}
