import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { AdminAuthProvider } from '@/context/AdminAuthContext';
import App from '@/App';
import '@/index.css';

const app = (
  <BrowserRouter>
    <AdminAuthProvider>
      <App />
    </AdminAuthProvider>
  </BrowserRouter>
);

createRoot(document.getElementById('root')).render(
  import.meta.env.DEV ? <StrictMode>{app}</StrictMode> : app,
);
