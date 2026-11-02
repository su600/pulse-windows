import { createRoot } from 'react-dom/client'
import { installDevMock } from '../shared/devMock'
import { Settings } from './Settings'
import './settings.css'

installDevMock()
createRoot(document.getElementById('root')!).render(<Settings />)
