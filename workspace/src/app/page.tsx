import Link from 'next/link';
import NavBar from '../components/NavBar';

export default function Home() {
  return (
    <div className="min-h-screen bg-slate-50">
      <NavBar />

      {/* Hero Section */}
      <main className="max-w-7xl mx-auto py-16 px-4 sm:py-24 sm:px-6 lg:px-8">
        <div className="text-center">
          <h1 className="text-3xl tracking-tight font-bold text-slate-900 sm:text-4xl md:text-5xl">
            <span className="block">Advance your health with</span>
            <span className="block text-blue-600 mt-1">AI-Powered Care</span>
          </h1>
          <p className="mt-4 max-w-xl mx-auto text-base font-medium text-slate-600 sm:text-lg md:mt-6 md:text-xl">
            Instant symptom triage, real-time health monitoring, and on-demand nurse visits.
            Experience the future of healthcare today.
          </p>
          <div className="mt-6 max-w-md mx-auto sm:flex sm:justify-center gap-3 md:mt-8">
            <Link href="/auth/signup" className="w-full flex items-center justify-center px-8 py-3 border border-transparent text-base font-semibold rounded-lg text-white bg-blue-600 hover:bg-blue-700 md:py-3.5 md:px-10">
              Get Started
            </Link>
            <Link href="/auth/login" className="w-full flex items-center justify-center px-8 py-3 border border-slate-300 text-base font-semibold rounded-lg text-slate-700 bg-white hover:bg-slate-50 md:py-3.5 md:px-10">
              Log In
            </Link>
          </div>
        </div>
      </main>
    </div>
  );
}
