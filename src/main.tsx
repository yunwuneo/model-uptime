import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { PublicPage } from './PublicPage';
import { Admin } from './admin/Admin';
import './styles.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<PublicPage />} />
        <Route path="/admin/*" element={<Admin />} />
        <Route
          path="*"
          element={
            <div className="empty">
              <h1>页面不存在</h1>
              <a href="/">返回状态页</a>
            </div>
          }
        />
      </Routes>
    </BrowserRouter>
  </React.StrictMode>,
);
