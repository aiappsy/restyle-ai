import React, { useEffect, useState } from 'react';
import { useAuth, User } from '../contexts/AuthContext';
import { useNavigate } from 'react-router-dom';
import { Users, Mail, MapPin, Database, Trophy, ArrowLeft } from 'lucide-react';

export default function AdminDashboard() {
  const { token, user } = useAuth();
  const navigate = useNavigate();
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    if (user?.role !== 'admin') {
      navigate('/');
      return;
    }

    const fetchUsers = async () => {
      try {
        const res = await fetch('/api/admin/users', {
          headers: { 'Authorization': `Bearer ${token}` }
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error);
        setUsers(data.users);
      } catch (e: any) {
        setError(e.message);
      } finally {
        setLoading(false);
      }
    };
    
    fetchUsers();
  }, [token, user, navigate]);

  if (loading) return <div className="p-8 text-center text-gray-500">Loading admin dashboard...</div>;
  if (error) return <div className="p-8 text-center text-red-500">Error: {error}</div>;

  return (
    <div className="min-h-screen bg-gray-50 p-8">
      <div className="max-w-7xl mx-auto">
        <button onClick={() => navigate('/')} className="mb-6 flex flex-row items-center gap-2 text-indigo-600 font-medium hover:text-indigo-800 transition">
          <ArrowLeft className="w-4 h-4"/> Back to App
        </button>
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-gray-900 flex items-center gap-3">
            <Users className="w-8 h-8 text-indigo-600" />
            User Management
          </h1>
          <p className="text-gray-500 mt-2">View and manage all registered users.</p>
        </div>

        <div className="bg-white shadow-sm rounded-xl overflow-hidden border border-gray-200">
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th scope="col" className="px-6 py-4 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">
                    Name
                  </th>
                  <th scope="col" className="px-6 py-4 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">
                    Contact
                  </th>
                  <th scope="col" className="px-6 py-4 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">
                    Location
                  </th>
                  <th scope="col" className="px-6 py-4 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">
                    Credits
                  </th>
                  <th scope="col" className="px-6 py-4 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {users.map((u) => (
                  <tr key={u.id} className="hover:bg-gray-50 transition-colors">
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="flex items-center">
                        <div className="flex-shrink-0 h-10 w-10 bg-indigo-100 rounded-full flex items-center justify-center text-indigo-700 font-bold">
                          {u.name.charAt(0).toUpperCase()}
                        </div>
                        <div className="ml-4">
                          <div className="text-sm font-medium text-gray-900">{u.name}</div>
                          <div className="text-sm text-gray-500 capitalize">{u.role}</div>
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="text-sm text-gray-900 flex items-center gap-1">
                        <Mail className="w-4 h-4 text-gray-400" />
                        {u.email}
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                       <span className="flex items-center gap-1">
                         <MapPin className="w-4 h-4 text-gray-400" />
                         {u.location || 'Unknown'}
                       </span>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <span className={`px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${u.credits > 0 ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}`}>
                        {u.credits} Remaining
                      </span>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm font-medium">
                      <a href={`mailto:${u.email}`} className="text-indigo-600 hover:text-indigo-900 flex items-center gap-1">
                        <Mail className="w-4 h-4" /> Email User
                      </a>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
