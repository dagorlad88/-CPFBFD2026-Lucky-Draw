import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { Lock, ArrowRight, ShieldCheck } from 'lucide-react';

export function Login() {
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();
  const { loginWithPin } = useAuth();

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    try {
      await loginWithPin(pin);
      navigate('/admin');
    } catch (err: any) {
      setError(err.message || 'Invalid PIN');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center relative star-bg px-6">
      <div className="absolute inset-0 z-0 flex justify-center pointer-events-none">
        <div className="w-[800px] h-full bg-gradient-to-b from-primary-container/5 to-transparent"></div>
      </div>
      
      <div className="relative z-10 w-full max-w-md md:max-w-3xl flex flex-col items-center">
        <div className="text-center mb-12">
          <h1 className="font-display text-4xl sm:text-5xl md:text-6xl font-black tracking-wide text-primary-container text-glow-sm mb-2 uppercase leading-tight whitespace-nowrap">
            #CPFBFamilyDay2026<br/>
            <span className="text-3xl md:text-5xl text-primary">Lucky Draw</span>
          </h1>
          <h2 className="font-display text-2xl font-bold text-on-surface tracking-widest uppercase mt-4">
            Admin Portal
          </h2>
        </div>

        <div className="bg-surface-container/80 backdrop-blur-md rounded-2xl p-8 shadow-[0_0_40px_rgba(255,213,79,0.1)] border border-outline/30 w-full max-w-md">
          <form onSubmit={handleLogin} className="flex flex-col gap-6">
            {error && (
              <div className="p-3 rounded bg-error/10 border border-error/30 text-error text-sm font-medium text-center">
                {error}
              </div>
            )}
            <div className="flex flex-col gap-2">
              <label className="font-mono text-sm font-bold text-on-surface-variant uppercase tracking-wider" htmlFor="pin">
                Access PIN
              </label>
              <div className="relative group rounded-lg border border-outline-variant bg-surface-container-low transition-all duration-300 focus-within:border-primary-container focus-within:shadow-[0_0_12px_rgba(255,213,79,0.3)]">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 text-on-surface-variant w-5 h-5" />
                <input
                  type="password"
                  id="pin"
                  autoComplete="current-password"
                  value={pin}
                  onChange={(e) => setPin(e.target.value)}
                  className="w-full bg-transparent border-none text-on-surface font-sans text-base pl-10 pr-4 py-3 focus:outline-none placeholder:text-on-surface-variant/50"
                  placeholder="Enter PIN to continue"
                  required
                />
              </div>
            </div>

            <div className="h-2"></div>

            <button 
              type="submit" 
              disabled={loading}
              className="w-full bg-primary-container hover:bg-primary-fixed text-on-primary-container font-display text-2xl font-black py-4 rounded-[24px] shadow-[0_0_20px_rgba(255,213,79,0.4)] hover:shadow-[0_0_30px_rgba(255,213,79,0.7)] transition-all duration-300 flex justify-center items-center gap-2 group disabled:opacity-50"
            >
              <span>{loading ? 'LOGGING IN...' : 'LOGIN'}</span>
              <ArrowRight className="group-hover:translate-x-1 transition-transform w-6 h-6" />
            </button>
          </form>

          <div className="mt-8 flex justify-center items-center gap-2 text-on-surface-variant/70 font-sans text-sm">
            <ShieldCheck className="w-4 h-4" />
            <span>Secure 256-bit Encrypted Connection</span>
          </div>
        </div>
      </div>
    </div>
  );
}
