import React from 'react';

import ReactDOM from 'react-dom/client';

import { BrowserRouter } from 'react-router-dom';

import App from './App';

import { AuthProvider } from './context/AuthContext';

import { ToastProvider } from './context/ToastContext';

import { ThemeProvider } from './context/ThemeContext';

import './index.css';



class RootErrorBoundary extends React.Component {

  constructor(props) {

    super(props);

    this.state = { error: null };

  }



  static getDerivedStateFromError(error) {

    return { error };

  }



  render() {

    if (this.state.error) {

      return (

        <div

          style={{

            minHeight: '100vh',

            background: '#0a0b0d',

            color: '#f4f4f5',

            padding: '2rem',

            fontFamily: 'system-ui, sans-serif',

          }}

        >

          <h1 style={{ color: '#00A876', marginBottom: '1rem' }}>Delta Exchange — load error</h1>

          <p style={{ marginBottom: '1rem', opacity: 0.85 }}>

            The app hit a runtime error. Refresh the page after saving any code changes.

          </p>

          <pre

            style={{

              background: 'rgba(0,0,0,0.4)',

              border: '1px solid rgba(255,255,255,0.1)',

              borderRadius: '8px',

              padding: '1rem',

              fontSize: '12px',

              whiteSpace: 'pre-wrap',

              wordBreak: 'break-word',

              color: '#fca5a5',

              marginBottom: '1.25rem',

            }}

          >

            {String(this.state.error?.message || this.state.error)}

          </pre>

          <button

            type="button"

            onClick={() => window.location.reload()}

            style={{

              background: 'linear-gradient(135deg, #FE6C02, #00A876)',

              color: '#101013',

              fontWeight: 700,

              border: 'none',

              borderRadius: '10px',

              padding: '0.75rem 1.25rem',

              cursor: 'pointer',

            }}

          >

            Reload page

          </button>

        </div>

      );

    }

    return this.props.children;

  }

}



ReactDOM.createRoot(document.getElementById('root')).render(

  <RootErrorBoundary>

    <BrowserRouter>

      <ThemeProvider>

        <AuthProvider>

          <ToastProvider>

            <App />

          </ToastProvider>

        </AuthProvider>

      </ThemeProvider>

    </BrowserRouter>

  </RootErrorBoundary>,

);

