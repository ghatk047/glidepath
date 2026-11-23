import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { RouterProvider } from '@tanstack/react-router';
import '@glidepath/ui/src/tokens/tokens.css';
import { reducedMotionCss } from '@glidepath/ui/src/motion';
import './app.css';
import { schedulePreload } from './modules';
import { createAppRouter } from './router';

const router = createAppRouter();

const style = document.createElement('style');
style.textContent = reducedMotionCss;
document.head.append(style);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
);

// Cockpit, Levers and Path are fetched once the first screen has painted (07 §5).
schedulePreload();
