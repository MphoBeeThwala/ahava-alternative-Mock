import { useEffect, useState } from "react";
import { useAuth } from "@/react-app/lib/auth-context";
import { useNavigate } from "react-router";
import { Users, Shield, AlertTriangle, Activity, FileText, CheckCircle } from "lucide-react";

interface Profile {
  id: number;
  user_id: string;
  full_name: string;
  role: string;
  email?: string;
  phone_number?: string;
  is_verified: number;
  is_online: number;
  sanc_id?: string;
  created_at: string;
}

interface PanicAlert {
  id: number;
  nurse_id: string;
  nurse_name?: string;
  alert_status: string;
  latitude?: number;
  longitude?: number;
  address?: string;
  created_at: string;
  notes?: string;
}

interface Appointment {
  id: number;
  patient_id: string;
  nurse_id?: string;
  status: string;
  service_type: string;
  patient_address?: string;
  created_at: string;
}

interface DiagnosticReport {
  id: number;
  patient_id: string;
  report_type: string;
  is_released: number;
  created_at: string;
}

interface Stats {
  totalUsers: number;
  totalPatients: number;
  totalNurses: number;
  totalDoctors: number;
  activePanicAlerts: number;
  pendingReports: number;
  activeAppointments: number;
  verifiedNurses: number;
}

export default function AdminDashboard() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState<"overview" | "users" | "alerts" | "appointments" | "reports">("overview");
  const [users, setUsers] = useState<Profile[]>([]);
  const [panicAlerts, setPanicAlerts] = useState<PanicAlert[]>([]);
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [reports, setReports] = useState<DiagnosticReport[]>([]);
  const [stats, setStats] = useState<Stats>({
    totalUsers: 0,
    totalPatients: 0,
    totalNurses: 0,
    totalDoctors: 0,
    activePanicAlerts: 0,
    pendingReports: 0,
    activeAppointments: 0,
    verifiedNurses: 0,
  });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) {
      navigate("/");
      return;
    }
    fetchDashboardData();
  }, [user, navigate]);

  const fetchDashboardData = async () => {
    try {
      const [usersRes, alertsRes, appointmentsRes, reportsRes, statsRes] = await Promise.all([
        fetch("/api/admin/users"),
        fetch("/api/admin/panic-alerts"),
        fetch("/api/admin/appointments"),
        fetch("/api/admin/diagnostic-reports"),
        fetch("/api/admin/stats"),
      ]);

      if (usersRes.ok) {
        const data = await usersRes.json();
        setUsers(data.users || []);
      }

      if (alertsRes.ok) {
        const data = await alertsRes.json();
        setPanicAlerts(data.alerts || []);
      }

      if (appointmentsRes.ok) {
        const data = await appointmentsRes.json();
        setAppointments(data.appointments || []);
      }

      if (reportsRes.ok) {
        const data = await reportsRes.json();
        setReports(data.reports || []);
      }

      if (statsRes.ok) {
        const data = await statsRes.json();
        setStats(data.stats || stats);
      }
    } catch (error) {
      console.error("Failed to fetch dashboard data:", error);
    } finally {
      setLoading(false);
    }
  };

  const handleVerifyNurse = async (userId: string) => {
    try {
      const response = await fetch(`/api/admin/users/${userId}/verify`, {
        method: "POST",
      });

      if (response.ok) {
        fetchDashboardData();
      }
    } catch (error) {
      console.error("Failed to verify nurse:", error);
    }
  };

  const handleResolveAlert = async (alertId: number, status: "RESOLVED" | "FALSE_ALARM") => {
    try {
      const response = await fetch(`/api/admin/panic-alerts/${alertId}/resolve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });

      if (response.ok) {
        fetchDashboardData();
      }
    } catch (error) {
      console.error("Failed to resolve alert:", error);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 to-blue-50 flex items-center justify-center">
        <div className="text-center">
          <div className="w-16 h-16 border-4 border-blue-600 border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
          <p className="text-slate-600">Loading admin dashboard...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-blue-50">
      {/* Header */}
      <div className="bg-white border-b border-slate-200 sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Shield className="w-8 h-8 text-blue-600" />
              <div>
                <h1 className="text-2xl font-bold text-slate-900">Admin Dashboard</h1>
                <p className="text-sm text-slate-600">Platform oversight and management</p>
              </div>
            </div>
            <button
              onClick={() => navigate("/")}
              className="px-4 py-2 text-sm text-slate-600 hover:text-slate-900"
            >
              Exit Admin
            </button>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Stats Overview */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
          <div className="bg-white rounded-xl p-6 border border-slate-200">
            <div className="flex items-center justify-between mb-2">
              <Users className="w-8 h-8 text-blue-600" />
              <span className="text-2xl font-bold text-slate-900">{stats.totalUsers}</span>
            </div>
            <p className="text-sm text-slate-600">Total Users</p>
            <div className="mt-2 text-xs text-slate-500">
              {stats.totalPatients} patients • {stats.totalNurses} nurses • {stats.totalDoctors} doctors
            </div>
          </div>

          <div className="bg-white rounded-xl p-6 border border-slate-200">
            <div className="flex items-center justify-between mb-2">
              <AlertTriangle className="w-8 h-8 text-red-600" />
              <span className="text-2xl font-bold text-slate-900">{stats.activePanicAlerts}</span>
            </div>
            <p className="text-sm text-slate-600">Active Panic Alerts</p>
            <div className="mt-2 text-xs text-slate-500">Requires immediate attention</div>
          </div>

          <div className="bg-white rounded-xl p-6 border border-slate-200">
            <div className="flex items-center justify-between mb-2">
              <Activity className="w-8 h-8 text-green-600" />
              <span className="text-2xl font-bold text-slate-900">{stats.activeAppointments}</span>
            </div>
            <p className="text-sm text-slate-600">Active Appointments</p>
            <div className="mt-2 text-xs text-slate-500">In progress or scheduled</div>
          </div>

          <div className="bg-white rounded-xl p-6 border border-slate-200">
            <div className="flex items-center justify-between mb-2">
              <FileText className="w-8 h-8 text-purple-600" />
              <span className="text-2xl font-bold text-slate-900">{stats.pendingReports}</span>
            </div>
            <p className="text-sm text-slate-600">Pending Reports</p>
            <div className="mt-2 text-xs text-slate-500">Awaiting doctor review</div>
          </div>
        </div>

        {/* Navigation Tabs */}
        <div className="bg-white rounded-xl border border-slate-200 mb-6">
          <div className="border-b border-slate-200 px-6">
            <div className="flex gap-4">
              {["overview", "users", "alerts", "appointments", "reports"].map((tab) => (
                <button
                  key={tab}
                  onClick={() => setActiveTab(tab as typeof activeTab)}
                  className={`px-4 py-3 text-sm font-medium capitalize transition-colors ${
                    activeTab === tab
                      ? "text-blue-600 border-b-2 border-blue-600"
                      : "text-slate-600 hover:text-slate-900"
                  }`}
                >
                  {tab}
                </button>
              ))}
            </div>
          </div>

          <div className="p-6">
            {activeTab === "overview" && (
              <div className="space-y-6">
                <div>
                  <h3 className="text-lg font-semibold text-slate-900 mb-4">Recent Activity</h3>
                  <div className="space-y-3">
                    {panicAlerts.filter(a => a.alert_status === "ACTIVE").slice(0, 3).map((alert) => (
                      <div key={alert.id} className="flex items-center justify-between p-4 bg-red-50 rounded-lg border border-red-200">
                        <div>
                          <p className="font-medium text-red-900">Panic Alert #{alert.id}</p>
                          <p className="text-sm text-red-700">{alert.address || "Location unavailable"}</p>
                        </div>
                        <button
                          onClick={() => setActiveTab("alerts")}
                          className="px-4 py-2 bg-red-600 text-white rounded-lg text-sm hover:bg-red-700"
                        >
                          View
                        </button>
                      </div>
                    ))}
                    {panicAlerts.filter(a => a.alert_status === "ACTIVE").length === 0 && (
                      <p className="text-sm text-slate-500 text-center py-4">No active panic alerts</p>
                    )}
                  </div>
                </div>
              </div>
            )}

            {activeTab === "users" && (
              <div>
                <h3 className="text-lg font-semibold text-slate-900 mb-4">User Management</h3>
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead className="bg-slate-50 border-b border-slate-200">
                      <tr>
                        <th className="px-4 py-3 text-left text-xs font-medium text-slate-600 uppercase">Name</th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-slate-600 uppercase">Role</th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-slate-600 uppercase">Phone</th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-slate-600 uppercase">Status</th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-slate-600 uppercase">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200">
                      {users.map((user) => (
                        <tr key={user.id} className="hover:bg-slate-50">
                          <td className="px-4 py-3 text-sm text-slate-900">{user.full_name || "N/A"}</td>
                          <td className="px-4 py-3 text-sm">
                            <span className={`px-2 py-1 rounded-full text-xs font-medium ${
                              user.role === "NURSE" ? "bg-green-100 text-green-800" :
                              user.role === "DOCTOR" ? "bg-purple-100 text-purple-800" :
                              "bg-blue-100 text-blue-800"
                            }`}>
                              {user.role}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-sm text-slate-600">{user.phone_number || "N/A"}</td>
                          <td className="px-4 py-3 text-sm">
                            {user.is_verified === 1 ? (
                              <span className="flex items-center gap-1 text-green-600">
                                <CheckCircle className="w-4 h-4" />
                                Verified
                              </span>
                            ) : (
                              <span className="text-slate-500">Unverified</span>
                            )}
                          </td>
                          <td className="px-4 py-3 text-sm">
                            {user.role === "NURSE" && user.is_verified === 0 && (
                              <button
                                onClick={() => handleVerifyNurse(user.user_id)}
                                className="px-3 py-1 bg-blue-600 text-white rounded text-xs hover:bg-blue-700"
                              >
                                Verify
                              </button>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {activeTab === "alerts" && (
              <div>
                <h3 className="text-lg font-semibold text-slate-900 mb-4">Panic Alerts</h3>
                <div className="space-y-3">
                  {panicAlerts.map((alert) => (
                    <div key={alert.id} className={`p-4 rounded-lg border ${
                      alert.alert_status === "ACTIVE" ? "bg-red-50 border-red-200" : "bg-slate-50 border-slate-200"
                    }`}>
                      <div className="flex items-start justify-between">
                        <div className="flex-1">
                          <div className="flex items-center gap-2 mb-2">
                            <span className="font-medium text-slate-900">Alert #{alert.id}</span>
                            <span className={`px-2 py-1 rounded-full text-xs font-medium ${
                              alert.alert_status === "ACTIVE" ? "bg-red-600 text-white" :
                              alert.alert_status === "RESOLVED" ? "bg-green-100 text-green-800" :
                              "bg-slate-200 text-slate-700"
                            }`}>
                              {alert.alert_status}
                            </span>
                          </div>
                          <p className="text-sm text-slate-600 mb-1">Nurse: {alert.nurse_name || alert.nurse_id}</p>
                          <p className="text-sm text-slate-600 mb-1">Location: {alert.address || "Unavailable"}</p>
                          <p className="text-xs text-slate-500">
                            {new Date(alert.created_at).toLocaleString()}
                          </p>
                        </div>
                        {alert.alert_status === "ACTIVE" && (
                          <div className="flex gap-2">
                            <button
                              onClick={() => handleResolveAlert(alert.id, "RESOLVED")}
                              className="px-3 py-1 bg-green-600 text-white rounded text-sm hover:bg-green-700"
                            >
                              Resolve
                            </button>
                            <button
                              onClick={() => handleResolveAlert(alert.id, "FALSE_ALARM")}
                              className="px-3 py-1 bg-slate-600 text-white rounded text-sm hover:bg-slate-700"
                            >
                              False Alarm
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                  {panicAlerts.length === 0 && (
                    <p className="text-sm text-slate-500 text-center py-8">No panic alerts</p>
                  )}
                </div>
              </div>
            )}

            {activeTab === "appointments" && (
              <div>
                <h3 className="text-lg font-semibold text-slate-900 mb-4">All Appointments</h3>
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead className="bg-slate-50 border-b border-slate-200">
                      <tr>
                        <th className="px-4 py-3 text-left text-xs font-medium text-slate-600 uppercase">ID</th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-slate-600 uppercase">Service</th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-slate-600 uppercase">Status</th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-slate-600 uppercase">Location</th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-slate-600 uppercase">Created</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200">
                      {appointments.map((apt) => (
                        <tr key={apt.id} className="hover:bg-slate-50">
                          <td className="px-4 py-3 text-sm text-slate-900">#{apt.id}</td>
                          <td className="px-4 py-3 text-sm text-slate-900">{apt.service_type}</td>
                          <td className="px-4 py-3 text-sm">
                            <span className={`px-2 py-1 rounded-full text-xs font-medium ${
                              apt.status === "COMPLETED" ? "bg-green-100 text-green-800" :
                              apt.status === "ACCEPTED" ? "bg-blue-100 text-blue-800" :
                              apt.status === "REQUESTED" ? "bg-yellow-100 text-yellow-800" :
                              "bg-slate-100 text-slate-800"
                            }`}>
                              {apt.status}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-sm text-slate-600">{apt.patient_address || "N/A"}</td>
                          <td className="px-4 py-3 text-sm text-slate-600">
                            {new Date(apt.created_at).toLocaleDateString()}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {activeTab === "reports" && (
              <div>
                <h3 className="text-lg font-semibold text-slate-900 mb-4">Diagnostic Reports</h3>
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead className="bg-slate-50 border-b border-slate-200">
                      <tr>
                        <th className="px-4 py-3 text-left text-xs font-medium text-slate-600 uppercase">ID</th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-slate-600 uppercase">Type</th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-slate-600 uppercase">Status</th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-slate-600 uppercase">Created</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200">
                      {reports.map((report) => (
                        <tr key={report.id} className="hover:bg-slate-50">
                          <td className="px-4 py-3 text-sm text-slate-900">#{report.id}</td>
                          <td className="px-4 py-3 text-sm text-slate-900">{report.report_type}</td>
                          <td className="px-4 py-3 text-sm">
                            <span className={`px-2 py-1 rounded-full text-xs font-medium ${
                              report.is_released === 1 ? "bg-green-100 text-green-800" : "bg-yellow-100 text-yellow-800"
                            }`}>
                              {report.is_released === 1 ? "Released" : "Pending"}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-sm text-slate-600">
                            {new Date(report.created_at).toLocaleDateString()}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
