/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './lib/auth';
import { Login } from './pages/Login';
import { AdminLayout } from './pages/AdminLayout';
import { Dashboard } from './pages/Admin/Dashboard';
import { UploadCsv } from './pages/Admin/UploadCsv';
import { PrizeSetup } from './pages/Admin/PrizeSetup';
import { BulkDraw } from './pages/Admin/BulkDraw';
import { AuditLogs } from './pages/Admin/AuditLogs';
import { LiveDraw } from './pages/Presentation/LiveDraw';

const ProtectedRoute = ({ children }: { children: React.ReactNode }) => {
  const { user } = useAuth();
  if (!user) {
    return <Navigate to="/login" />;
  }
  return children;
};

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<Login />} />
          
          <Route path="/admin" element={<ProtectedRoute><AdminLayout /></ProtectedRoute>}>
            <Route index element={<Navigate to="/admin/dashboard" />} />
            <Route path="dashboard" element={<Dashboard />} />
            <Route path="upload" element={<UploadCsv />} />
            <Route path="prizes" element={<PrizeSetup />} />
            <Route path="bulk" element={<BulkDraw />} />
            <Route path="audit" element={<AuditLogs />} />
          </Route>

          <Route path="/stage" element={<ProtectedRoute><LiveDraw /></ProtectedRoute>} />
          
          <Route path="/" element={<Navigate to="/admin" />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}

