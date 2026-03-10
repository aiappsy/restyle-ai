import React, { createContext, useContext, useState, useEffect } from 'react';

export interface User {
  id: number;
  name: string;
  email: string;
  location: string;
  role: 'user' | 'admin';
  credits: number;
}

interface AuthContextType {
  user: User | null;
  token: string | null;
  login: (token: string, user: User) => void;
  logout: () => void;
  isLoading: boolean;
  refreshToken: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(localStorage.getItem('restyle_token'));
  const [isLoading, setIsLoading] = useState(true);

  const login = (newToken: string, newUser: User) => {
    setToken(newToken);
    setUser(newUser);
    localStorage.setItem('restyle_token', newToken);
  };

  const logout = () => {
    setToken(null);
    setUser(null);
    localStorage.removeItem('restyle_token');
  };

  const refreshToken = async () => {
    if (!token) return;
    try {
      const res = await fetch('/api/auth/me', {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (res.ok) {
        const data = await res.json();
        setUser(data.user);
      } else {
        logout();
      }
    } catch (e) {
      console.error(e);
      logout();
    }
  };

  useEffect(() => {
    const initAuth = async () => {
      if (token) {
        await refreshToken();
      }
      setIsLoading(false);
    };
    initAuth();
  }, [token]);

  return (
    <AuthContext.Provider value={{ user, token, login, logout, isLoading, refreshToken }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
