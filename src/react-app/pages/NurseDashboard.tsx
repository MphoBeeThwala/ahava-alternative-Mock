import { useEffect, useState } from "react";
import { useAuth } from "@/react-app/lib/auth-context";
import { useNavigate } from "react-router";
import { MapPin, Clock, AlertOctagon, User, ToggleLeft, ToggleRight } from "lucide-react";
import PanicButton from "../components/PanicButton";

interface Profile {
  full_name: string;
  role: string;
  is_online: number;
  sanc_id: string;
  is_verified: number;
}

interface Appointment {
  id: number;
  patient_id: string;
  service_type: string;
  patient_address: string;
  notes: string;
  status: string;
  created_at: string;
}

export default function NurseDashboard() {
  const { logout } = useAuth();
  const navigate = useNavigate();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isOnline, setIsOnline] = useState(false);
  const [nearbyRequests, setNearbyRequests] = useState<Appointment[]>([]);

  useEffect(() => {
    loadProfile();
  }, []);

  useEffect(() => {
    if (isOnline && profile?.is_verified === 1) {
      loadNearbyRequests();
      const interval = setInterval(loadNearbyRequests, 10000); // Refresh every 10 seconds
      return () => clearInterval(interval);
    }
  }, [isOnline, profile]);

  const loadProfile = async () => {
    try {
      const response = await fetch("/api/profile");
      const data = await response.json();

      if (data.profile?.role !== "NURSE") {
        navigate("/onboarding");
        return;
      }

      setProfile(data.profile);
      setIsOnline(data.profile.is_online === 1);
    } catch (error) {
      console.error("Failed to load profile:", error);
    } finally {
      setIsLoading(false);
    }
  };

  const loadNearbyRequests = async () => {
    try {
      const response = await fetch("/api/appointments/nearby");
      const data = await response.json();
      setNearbyRequests(data.appointments || []);
    } catch (error) {
      console.error("Failed to load requests:", error);
    }
  };

  const acceptAppointment = async (appointmentId: number) => {
    try {
      await fetch(`/api/appointments/${appointmentId}/accept`, {
        method: "POST",
      });
      loadNearbyRequests();
    } catch (error) {
      console.error("Failed to accept appointment:", error);
    }
  };

  const toggleAvailability = async () => {
    try {
      const newStatus = !isOnline;
      await fetch("/api/nurse/availability", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ is_online: newStatus }),
      });

      setIsOnline(newStatus);
    } catch (error) {
      console.error("Failed to update availability:", error);
    }
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="animate-spin rounded-full h-16 w-16 border-t-2 border-b-2 border-[#34d399]"></div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Navigation */}
      <nav className="bg-white shadow-sm border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-16">
            <div className="flex items-center space-x-3">
              <img 
                src="https://019beed4-58f9-79ea-8acd-d59b2c121f81.mochausercontent.com/Ahava-on-88-logo.png"
                alt="Ahava Healthcare"
                className="h-10"
              />
              <span className="text-xl font-semibold text-[#004aad]">Ahava Healthcare</span>
            </div>
            <div className="flex items-center space-x-4">
              <PanicButton />
              <span className="text-sm text-gray-600">{profile?.full_name}</span>
              <button
                onClick={logout}
                className="px-4 py-2 text-sm font-medium text-gray-700 hover:text-gray-900 transition-colors"
              >
                Logout
              </button>
            </div>
          </div>
        </div>
      </nav>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Welcome Header */}
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-gray-900 mb-2">
            Welcome, {profile?.full_name?.split(" ")[0]}
          </h1>
          <p className="text-gray-600">Manage your appointments and availability</p>
        </div>

        {/* Status Card */}
        <div className="bg-gradient-to-br from-[#34d399] to-[#10b981] rounded-xl p-8 text-white mb-8">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-2xl font-bold mb-2">Your Status</h2>
              <p className="text-white/90">
                {isOnline ? "You're online and available for appointments" : "You're currently offline"}
              </p>
            </div>
            <button
              onClick={toggleAvailability}
              className="bg-white/20 backdrop-blur-sm rounded-2xl p-4 hover:bg-white/30 transition-all"
            >
              {isOnline ? (
                <ToggleRight className="w-16 h-16 text-white" />
              ) : (
                <ToggleLeft className="w-16 h-16 text-white/60" />
              )}
            </button>
          </div>
        </div>

        {/* Verification Status */}
        {profile?.is_verified === 0 && (
          <div className="bg-yellow-50 border border-yellow-200 rounded-xl p-6 mb-8">
            <div className="flex items-start">
              <AlertOctagon className="w-6 h-6 text-yellow-600 mr-3 flex-shrink-0 mt-1" />
              <div>
                <h3 className="font-bold text-yellow-900 mb-1">Verification Pending</h3>
                <p className="text-yellow-800 text-sm">
                  Your SANC registration ({profile?.sanc_id}) is being verified. You'll be able to accept appointments once verified.
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Incoming Requests */}
        <div className="grid md:grid-cols-2 gap-6 mb-8">
          {/* Requests Map */}
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-xl font-bold text-gray-900">Nearby Requests</h3>
              <MapPin className="w-5 h-5 text-gray-400" />
            </div>
            <div className="bg-gray-100 rounded-lg h-64 flex items-center justify-center">
              <p className="text-gray-500">Map view coming soon</p>
            </div>
          </div>

          {/* Request List */}
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
            <h3 className="text-xl font-bold text-gray-900 mb-4">Active Requests</h3>
            <div className="space-y-4">
              {profile?.is_verified === 0 ? (
                <p className="text-gray-500 text-center py-8">
                  Complete verification to see appointment requests
                </p>
              ) : !isOnline ? (
                <p className="text-gray-500 text-center py-8">
                  Toggle availability on to see requests
                </p>
              ) : nearbyRequests.length === 0 ? (
                <p className="text-gray-500 text-center py-8">
                  No active requests in your area
                </p>
              ) : (
                nearbyRequests.map((request) => (
                  <div key={request.id} className="border border-gray-200 rounded-lg p-4 hover:border-[#34d399] transition-colors">
                    <div className="flex items-start justify-between mb-3">
                      <div>
                        <h4 className="font-semibold text-gray-900 mb-1">
                          {request.service_type.replace(/_/g, " ")}
                        </h4>
                        <p className="text-sm text-gray-600 flex items-center">
                          <MapPin className="w-4 h-4 mr-1" />
                          {request.patient_address}
                        </p>
                      </div>
                      <span className="text-xs text-gray-500">
                        {new Date(request.created_at).toLocaleTimeString()}
                      </span>
                    </div>
                    {request.notes && (
                      <p className="text-sm text-gray-600 mb-3 italic">"{request.notes}"</p>
                    )}
                    <button
                      onClick={() => acceptAppointment(request.id)}
                      className="w-full px-4 py-2 bg-[#34d399] text-white rounded-lg font-medium hover:bg-[#10b981] transition-colors"
                    >
                      Accept Appointment
                    </button>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>

        {/* Stats Cards */}
        <div className="grid md:grid-cols-3 gap-6">
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
            <div className="w-12 h-12 bg-blue-100 rounded-lg flex items-center justify-center mb-4">
              <User className="w-6 h-6 text-blue-600" />
            </div>
            <div className="text-3xl font-bold text-gray-900 mb-1">0</div>
            <p className="text-gray-600">Total Patients</p>
          </div>

          <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
            <div className="w-12 h-12 bg-green-100 rounded-lg flex items-center justify-center mb-4">
              <Clock className="w-6 h-6 text-green-600" />
            </div>
            <div className="text-3xl font-bold text-gray-900 mb-1">0</div>
            <p className="text-gray-600">Completed Visits</p>
          </div>

          <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
            <div className="w-12 h-12 bg-purple-100 rounded-lg flex items-center justify-center mb-4">
              <MapPin className="w-6 h-6 text-purple-600" />
            </div>
            <div className="text-3xl font-bold text-gray-900 mb-1">-</div>
            <p className="text-gray-600">Service Radius</p>
          </div>
        </div>
      </main>
    </div>
  );
}
