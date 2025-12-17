import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import PrintInboxHub from './PrintInboxHub.jsx';


createRoot(document.getElementById('root')).render(
  <StrictMode>
    <PrintInboxHub />
  </StrictMode>,
)
