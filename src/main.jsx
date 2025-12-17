import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import PrintInboxHub from './PrintInboxHub.jsx';
import PrintInboxHub2 from './PrintInboxHub2.jsx';

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <PrintInboxHub />
  </StrictMode>,
)
