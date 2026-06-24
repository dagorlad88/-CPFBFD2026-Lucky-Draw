import React, { createContext, useContext, useEffect, useState } from 'react';

/** Default PIN required to access the admin portal. */
const DEFAULT_PIN = 'abcd-1234';

interface AuthContextType {
  user: any;
  loading: boolean;
  loginWithPin: (pin: string) => Promise<any>;
  logout: () => Promise<void>;
  isMock: boolean;
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  loading: true,
  loginWithPin: async () => {},
  logout: async () => {},
  isMock: true,
});

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  // Restore auth session from localStorage on mount
  useEffect(() => {
    const saved = localStorage.getItem('authUser');
    if (saved) {
      try {
        setUser(JSON.parse(saved));
      } catch {
        // ignore parse errors
      }
    }
    setLoading(false);
  }, []);

  const loginWithPin = async (pin: string) => {
    if (pin !== DEFAULT_PIN) {
      throw new Error('Invalid PIN. Please try again.');
    }
    const adminUser = {
      uid: 'local-admin',
      displayName: 'Admin',
      email: 'admin@local',
    };
    setUser(adminUser);
    localStorage.setItem('authUser', JSON.stringify(adminUser));
    return adminUser;
  };

  const logout = async () => {
    setUser(null);
    localStorage.removeItem('authUser');
  };

  return (
    <AuthContext.Provider value={{ user, loading, loginWithPin, logout, isMock: true }}>
      {!loading && children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);