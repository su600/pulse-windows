import { createRoot } from 'react-dom/client'
import { installDevMock } from '../shared/devMock'
import { Panel } from './Panel'
import './panel.css'

installDevMock()
createRoot(document.getElementById('root')!).render(<Panel />)
