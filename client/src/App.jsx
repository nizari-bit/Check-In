import { Navigate, Route, Routes } from "react-router-dom";
import { adminSession } from "./api.js";
import Brand from "./components/Brand.jsx";
import AdminLogin from "./pages/AdminLogin.jsx";
import Events from "./pages/Events.jsx";
import EventDetail from "./pages/EventDetail.jsx";
import PrintSheet from "./pages/PrintSheet.jsx";
import ScannerLogin from "./pages/ScannerLogin.jsx";
import Scanner from "./pages/Scanner.jsx";

const AdminOnly = ({ children }) =>
  adminSession.get() ? children : <Navigate to="/admin/login" replace />;

function Landing() {
  return (
    <div className="grid min-h-screen place-items-center bg-teal p-6 text-center text-white">
      <div>
        <Brand className="text-2xl text-white" />
        <p className="mt-3 text-sm text-white/80">
          Please open the event link you were given.
        </p>
      </div>
    </div>
  );
}

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Landing />} />
      <Route path="/admin/login" element={<AdminLogin />} />
      <Route
        path="/admin"
        element={
          <AdminOnly>
            <Events />
          </AdminOnly>
        }
      />

      <Route
        path="/admin/events/:id"
        element={
          <AdminOnly>
            <EventDetail />
          </AdminOnly>
        }
      />

      <Route
        path="/admin/events/:id/print"
        element={
          <AdminOnly>
            <PrintSheet />
          </AdminOnly>
        }
      />
      
      <Route path="/e/:token" element={<ScannerLogin />} />
      <Route path="/scan" element={<Scanner />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
