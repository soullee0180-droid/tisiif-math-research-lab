import React from 'react';
import {createRoot} from 'react-dom/client';
import {BrowserRouter} from 'react-router-dom';
import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
import '@fontsource-variable/noto-sans-kr';
import 'katex/dist/katex.min.css';
import './style.css';
import App from './App';
const client=new QueryClient({defaultOptions:{queries:{refetchOnWindowFocus:false,staleTime:1000,retry:1}}});
createRoot(document.getElementById('root')!).render(<React.StrictMode><QueryClientProvider client={client}><BrowserRouter><App/></BrowserRouter></QueryClientProvider></React.StrictMode>);

