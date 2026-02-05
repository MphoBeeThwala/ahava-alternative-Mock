import { useEffect, useState, useRef } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { useAuth } from "@/react-app/lib/auth-context";

export default function AuthCallbackPage() {
  const { refreshUser } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [status, setStatus] = useState<string>("Completing authentication...");
  const hasRun = useRef(false); // Prevent double execution

  useEffect(() => {
    // Prevent double execution in React Strict Mode
    if (hasRun.current) {
      console.log("AuthCallback: Already processing, skipping duplicate call");
      return;
    }
    hasRun.current = true;

    const handleCallback = async () => {
      try {
        // Check if this is a success redirect from the worker
        const success = searchParams.get("success");
        if (success === "true") {
          console.log("AuthCallback: Worker completed OAuth, refreshing session...");
          // Worker already completed OAuth and set the session cookie
          setStatus("Setting up your session...");
          
          // Wait a moment for cookie to be fully set
          await new Promise(resolve => setTimeout(resolve, 1000));
          
          // Refresh the auth context to pick up the new session
          await refreshUser();
          
          // Navigate to onboarding
          console.log("AuthCallback: Redirecting to onboarding");
          navigate("/onboarding");
          return;
        }

        // If we get here, we should never be handling the direct Google callback
        // because the worker should handle it and redirect with success=true
        console.error("AuthCallback: Unexpected direct Google callback - worker should handle this");
        setStatus("Redirecting...");
        
        // Just wait and try to refresh - maybe we got here by mistake
        await new Promise(resolve => setTimeout(resolve, 1000));
        await refreshUser();
        navigate("/onboarding");
        
      } catch (error) {
        console.error("AuthCallback: Authentication failed:", error);
        setStatus("Authentication failed. Please try again.");
        setTimeout(() => navigate("/"), 2000);
      }
    };

    handleCallback();
  }, []); // Empty dependency array - only run once on mount

  return (
    <div className="min-h-screen bg-gradient-to-br from-[#004aad] to-[#0066cc] flex items-center justify-center">
      <div className="text-white text-center">
        <div className="animate-spin rounded-full h-16 w-16 border-t-2 border-b-2 border-white mx-auto mb-4"></div>
        <p className="text-xl">{status}</p>
      </div>
    </div>
  );
}
